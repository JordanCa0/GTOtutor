//! The live turn/river solver service (docs/postflop-plan.md, "Live turn and river solving").
//!
//! It takes one JSON request (`live::LiveRequest`) and returns the solve as JSON. It has no state,
//! no secrets and no data access: the API owns the cache and is the only caller. AGPL-3.0; every
//! response carries the commit it was built from, and the app links to that commit's source.
//!
//! - On AWS Lambda (AWS_LAMBDA_RUNTIME_API is set): serves invocations through the Lambda runtime API.
//! - `live --serve 7879`: the same over plain HTTP for local development (POST /solve).
//!
//! Response: `{ "commit": "...", "seconds": 1.2, "gz": "<base64 gzip of LiveOut JSON>" }` or
//! `{ "commit": "...", "error": "..." }`. The result is gzipped because a turn solve with raises
//! can exceed Lambda's 6 MB response limit as plain JSON.

use base64::Engine;
use flate2::{write::GzEncoder, Compression};
use gtotutor_solver::live::{solve, LiveRequest};
use serde_json::json;
use std::io::Write;
use std::time::Instant;

/// Set at build time (`GIT_COMMIT=<sha> cargo build`); the Lambda image build passes it in.
const COMMIT: &str = match option_env!("GIT_COMMIT") {
    Some(c) => c,
    None => "dev",
};

fn handle(body: &[u8]) -> serde_json::Value {
    let start = Instant::now();
    let req: LiveRequest = match serde_json::from_slice(body) {
        Ok(r) => r,
        Err(e) => return json!({ "commit": COMMIT, "error": format!("bad request: {e}") }),
    };
    match solve(&req) {
        Ok(out) => {
            let mut gz = GzEncoder::new(Vec::new(), Compression::fast());
            gz.write_all(&serde_json::to_vec(&out).unwrap()).unwrap();
            let bytes = gz.finish().unwrap();
            json!({
                "commit": COMMIT,
                "seconds": start.elapsed().as_secs_f64(),
                "gz": base64::engine::general_purpose::STANDARD.encode(bytes),
            })
        }
        Err(e) => json!({ "commit": COMMIT, "error": e }),
    }
}

/// The Lambda runtime API loop: fetch the next invocation, answer it, repeat.
fn lambda(api: &str) -> ! {
    let base = format!("http://{api}/2018-06-01/runtime/invocation");
    loop {
        let mut next = match ureq::get(format!("{base}/next")).call() {
            Ok(r) => r,
            Err(e) => {
                eprintln!("runtime api: {e}");
                std::thread::sleep(std::time::Duration::from_millis(200));
                continue;
            }
        };
        let id = next
            .headers()
            .get("Lambda-Runtime-Aws-Request-Id")
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default()
            .to_string();
        let body = next.body_mut().with_config().limit(16 << 20).read_to_vec().unwrap_or_default();
        let out = handle(&body);
        if let Some(err) = out.get("error") {
            eprintln!("{id}: {err}");
        }
        if let Err(e) = ureq::post(format!("{base}/{id}/response"))
            .header("Content-Type", "application/json")
            .send(serde_json::to_vec(&out).unwrap().as_slice())
        {
            eprintln!("{id}: could not send the response: {e}");
        }
    }
}

/// Local development: POST /solve with the request JSON, one request at a time.
fn serve(port: u16) {
    let server = tiny_http::Server::http(("127.0.0.1", port)).unwrap_or_else(|e| {
        eprintln!("cannot listen on 127.0.0.1:{port}: {e}");
        std::process::exit(2);
    });
    println!("live solver ({COMMIT}) on http://127.0.0.1:{port}/solve");
    for mut req in server.incoming_requests() {
        if req.method() != &tiny_http::Method::Post || req.url() != "/solve" {
            let _ = req.respond(tiny_http::Response::from_string("POST /solve").with_status_code(404));
            continue;
        }
        let mut body = Vec::new();
        let _ = req.as_reader().read_to_end(&mut body);
        let out = handle(&body);
        match out.get("seconds") {
            Some(s) => println!("solved in {:.2}s", s.as_f64().unwrap_or(0.0)),
            None => println!("error: {}", out["error"]),
        }
        let header = tiny_http::Header::from_bytes("Content-Type", "application/json").unwrap();
        let _ = req.respond(tiny_http::Response::from_data(serde_json::to_vec(&out).unwrap()).with_header(header));
    }
}

fn main() {
    if let Ok(api) = std::env::var("AWS_LAMBDA_RUNTIME_API") {
        lambda(&api);
    }
    let argv: Vec<String> = std::env::args().skip(1).collect();
    match argv.as_slice() {
        [flag, port] if flag == "--serve" => serve(port.parse().unwrap_or_else(|_| {
            eprintln!("--serve needs a port number");
            std::process::exit(2);
        })),
        _ => {
            eprintln!("usage: live --serve <port>   (on AWS Lambda it runs as the function handler)");
            std::process::exit(2);
        }
    }
}
