//! Progress tracking: a live terminal line, `<out>/<spot>/_progress.json`, and an optional
//! status page on the local network (`--status-port`).

use serde::Serialize;
use std::io::{Read, Write};
use std::net::{TcpListener, UdpSocket};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

#[derive(Serialize, Clone)]
pub struct Finished {
    pub flop: String,
    pub seconds: f64,
    pub exploitability_pct_pot: f32,
}

#[derive(Serialize, Clone, Default)]
pub struct Status {
    pub spot: String,
    pub total_flops: usize,
    /// Includes flops finished in earlier runs.
    pub done_flops: usize,
    pub solved_this_run: usize,
    pub failed: Vec<String>,
    pub current_flop: Option<String>,
    pub iteration: u32,
    pub max_iterations: u32,
    pub exploitability_pct_pot: Option<f32>,
    pub target_pct_pot: f32,
    pub current_flop_seconds: f64,
    pub avg_seconds_per_flop: Option<f64>,
    pub eta_hours: Option<f64>,
    pub running_hours: f64,
    pub finished: bool,
    pub updated_unix: u64,
    pub recent: Vec<Finished>,
}

pub struct Tracker {
    status: Arc<Mutex<Status>>,
    file: PathBuf,
    run_start: Instant,
    flop_start: Instant,
    solve_seconds: f64,
    last_write: Instant,
}

impl Tracker {
    pub fn new(status: Status, file: PathBuf) -> Self {
        let now = Instant::now();
        let mut t = Tracker { status: Arc::new(Mutex::new(status)), file, run_start: now, flop_start: now, solve_seconds: 0.0, last_write: now };
        t.save();
        t
    }

    /// Serves an auto-refreshing status page (and `/status.json`) on all network interfaces.
    pub fn serve(&self, port: u16) -> std::io::Result<String> {
        let listener = TcpListener::bind(("0.0.0.0", port))?;
        let status = Arc::clone(&self.status);
        std::thread::spawn(move || {
            for mut stream in listener.incoming().flatten() {
                let mut buf = [0u8; 1024];
                let n = stream.read(&mut buf).unwrap_or(0);
                let wants_json = String::from_utf8_lossy(&buf[..n]).starts_with("GET /status.json");
                let snapshot = status.lock().unwrap().clone();
                let (kind, body) = if wants_json {
                    ("application/json", serde_json::to_string(&snapshot).unwrap())
                } else {
                    ("text/html; charset=utf-8", render_html(&snapshot))
                };
                let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}", body.len());
            }
        });
        Ok(format!("http://{}:{port}", local_ip().unwrap_or_else(|| "localhost".into())))
    }

    pub fn start_flop(&mut self, flop: &str) {
        self.flop_start = Instant::now();
        self.update(|s| {
            s.current_flop = Some(flop.to_string());
            s.iteration = 0;
            s.exploitability_pct_pot = None;
        });
        self.save();
    }

    pub fn iteration(&mut self, iteration: u32, exploitability_pct_pot: Option<f32>) {
        let elapsed = self.flop_start.elapsed().as_secs_f64();
        self.update(|s| {
            s.iteration = iteration;
            if exploitability_pct_pot.is_some() {
                s.exploitability_pct_pot = exploitability_pct_pot;
            }
            s.current_flop_seconds = elapsed;
        });
        self.print_line();
        if self.last_write.elapsed().as_secs() >= 15 {
            self.save();
        }
    }

    pub fn finish_flop(&mut self, flop: &str, result: Option<(f64, f32)>) {
        if let Some((seconds, _)) = result {
            self.solve_seconds += seconds;
        }
        let solve_seconds = self.solve_seconds;
        self.update(|s| {
            s.current_flop = None;
            match result {
                Some((seconds, expl)) => {
                    s.done_flops += 1;
                    s.solved_this_run += 1;
                    s.recent.insert(0, Finished { flop: flop.to_string(), seconds, exploitability_pct_pot: expl });
                    s.recent.truncate(10);
                }
                None => s.failed.push(flop.to_string()),
            }
            if s.solved_this_run > 0 {
                let avg = solve_seconds / s.solved_this_run as f64;
                s.avg_seconds_per_flop = Some(avg);
                s.eta_hours = Some(avg * (s.total_flops - s.done_flops - s.failed.len()) as f64 / 3600.0);
            }
        });
        let s = self.status.lock().unwrap().clone();
        match result {
            Some((seconds, expl)) => println!(
                "\r[{}/{}] {flop} solved in {} ({expl:.2}% pot){}{:20}",
                s.done_flops,
                s.total_flops,
                duration(seconds),
                s.eta_hours.map(|h| format!(" | ETA {}", duration(h * 3600.0))).unwrap_or_default(),
                ""
            ),
            None => println!("\r{flop} failed{:60}", ""),
        }
        self.save();
    }

    pub fn finish(&mut self) {
        self.update(|s| s.finished = true);
        self.save();
    }

    fn update(&self, f: impl FnOnce(&mut Status)) {
        let mut s = self.status.lock().unwrap();
        f(&mut s);
        s.running_hours = self.run_start.elapsed().as_secs_f64() / 3600.0;
        s.updated_unix = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    }

    fn print_line(&self) {
        let s = self.status.lock().unwrap();
        let pct = 100.0 * s.done_flops as f64 / s.total_flops.max(1) as f64;
        print!(
            "\r{} {pct:5.1}% | {} iter {}/{} | accuracy {} -> {:.1}% | {}{:10}",
            bar(pct, 20),
            s.current_flop.as_deref().unwrap_or("-"),
            s.iteration,
            s.max_iterations,
            s.exploitability_pct_pot.map(|e| format!("{e:.2}%")).unwrap_or_else(|| "?".into()),
            s.target_pct_pot,
            duration(s.current_flop_seconds),
            ""
        );
        let _ = std::io::stdout().flush();
    }

    fn save(&mut self) {
        self.last_write = Instant::now();
        let json = serde_json::to_vec_pretty(&*self.status.lock().unwrap()).unwrap();
        let tmp = self.file.with_extension("json.tmp");
        if std::fs::write(&tmp, json).is_ok() {
            let _ = std::fs::rename(tmp, &self.file);
        }
    }
}

fn bar(pct: f64, width: usize) -> String {
    let filled = ((pct / 100.0) * width as f64).round() as usize;
    format!("[{}{}]", "#".repeat(filled.min(width)), "-".repeat(width - filled.min(width)))
}

pub fn duration(seconds: f64) -> String {
    let s = seconds.max(0.0) as u64;
    match s {
        0..=59 => format!("{s}s"),
        60..=3599 => format!("{}m{:02}s", s / 60, s % 60),
        _ => format!("{}h{:02}m", s / 3600, (s % 3600) / 60),
    }
}

/// This machine's LAN address (no packets are sent; connecting a UDP socket only picks a route).
fn local_ip() -> Option<String> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("192.168.0.1:80").ok()?;
    Some(socket.local_addr().ok()?.ip().to_string())
}

fn render_html(s: &Status) -> String {
    let pct = 100.0 * s.done_flops as f64 / s.total_flops.max(1) as f64;
    let state = if s.finished {
        "Finished".to_string()
    } else if let Some(f) = &s.current_flop {
        format!(
            "Solving <b>{f}</b>: iteration {} / {}, accuracy {} (target {:.1}%), {}",
            s.iteration,
            s.max_iterations,
            s.exploitability_pct_pot.map(|e| format!("{e:.2}%")).unwrap_or_else(|| "measuring…".into()),
            s.target_pct_pot,
            duration(s.current_flop_seconds)
        )
    } else {
        "Between flops".to_string()
    };
    let recent: String = s
        .recent
        .iter()
        .map(|r| format!("<tr><td>{}</td><td>{}</td><td>{:.2}%</td></tr>", r.flop, duration(r.seconds), r.exploitability_pct_pot))
        .collect();
    let failed = if s.failed.is_empty() { String::new() } else { format!("<p class=bad>Failed: {}</p>", s.failed.join(", ")) };
    format!(
        r#"<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<meta http-equiv=refresh content=5><title>Solver {pct:.0}%</title><style>
body{{font:15px system-ui,sans-serif;background:#0f1318;color:#e8e6e1;margin:0;padding:24px 16px;max-width:640px;margin:auto}}
h1{{font-size:20px;margin:0 0 4px}}.muted{{color:#8b939e}}.bar{{height:14px;background:#1f2630;border-radius:7px;overflow:hidden;margin:16px 0 8px}}
.fill{{height:100%;background:linear-gradient(90deg,#b8924a,#e2c27a);width:{pct:.2}%}}.grid{{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:16px 0}}
.card{{background:#171d25;border:1px solid #262f3b;border-radius:10px;padding:10px}}.card b{{display:block;font-size:20px;margin-top:2px}}
table{{width:100%;border-collapse:collapse}}td,th{{text-align:left;padding:6px 4px;border-bottom:1px solid #222a35}}.bad{{color:#e07a6b}}
</style></head><body><h1>GTOtutor solver · {spot}</h1><div class=muted>updates every 5 seconds</div>
<div class=bar><div class=fill></div></div><div><b>{done} / {total}</b> flops ({pct:.1}%)</div>
<div class=grid><div class=card>ETA<b>{eta}</b></div><div class=card>Per flop<b>{avg}</b></div><div class=card>Running<b>{running}</b></div></div>
<p>{state}</p>{failed}<h2 style="font-size:16px">Recent</h2><table><tr><th>Flop</th><th>Time</th><th>Accuracy</th></tr>{recent}</table></body></html>"#,
        spot = s.spot,
        done = s.done_flops,
        total = s.total_flops,
        eta = s.eta_hours.map(|h| duration(h * 3600.0)).unwrap_or_else(|| "–".into()),
        avg = s.avg_seconds_per_flop.map(duration).unwrap_or_else(|| "–".into()),
        running = duration(s.running_hours * 3600.0),
    )
}
