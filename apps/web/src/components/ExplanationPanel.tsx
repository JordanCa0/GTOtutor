import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

export function ExplanationPanel({ handId, decisionId }: { handId: string; decisionId: string }) {
  const { data, isFetching, error, refetch } = useQuery({
    queryKey: ['explanation', decisionId],
    queryFn: () => api.explanation(handId, decisionId),
  });

  const retry = (
    <button className="link" onClick={() => refetch()}>
      Retry
    </button>
  );

  return (
    <section className="coach">
      <h3>AI coach</h3>
      {isFetching ? (
        <p className="muted pulse">Coach is reviewing the spot…</p>
      ) : error ? (
        <p className="error small">
          {error.message} {retry}
        </p>
      ) : data?.status === 'unavailable' ? (
        <p className="muted small">
          Explanation unavailable: {data.reason} {retry}
        </p>
      ) : data ? (
        <>
          {data.explanationText.split(/\n\s*\n/).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          {data.keyFactors.length > 0 && (
            <ul className="factors">
              {data.keyFactors.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
          {data.ungroundedNumbers.length > 0 && (
            <p className="warn small">
              Heads up: this explanation mentions {data.ungroundedNumbers.join(', ')}, which isn't in the chart data. Trust the numbers above over the text. {retry}
            </p>
          )}
        </>
      ) : null}
    </section>
  );
}
