import { STAR_NOTE_MAX_CHARS, type DecisionStar } from '@gtotutor/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { StarIcon } from './icons';

/** A decision's star and note, shared by the star button and the note field. */
function useDecisionStar(handId: string, decisionId: string) {
  const queryClient = useQueryClient();
  const queryKey = ['star', decisionId];
  const query = useQuery({ queryKey, queryFn: () => api.star(handId, decisionId), staleTime: Infinity });
  const save = useMutation({
    mutationFn: (star: DecisionStar) => api.setStar(handId, decisionId, star),
    onSuccess: (star) => queryClient.setQueryData(queryKey, star),
  });
  return { star: query.data, save };
}

/** Star a decision to come back to it later. */
export function StarButton({ handId, decisionId }: { handId: string; decisionId: string }) {
  const { star, save } = useDecisionStar(handId, decisionId);
  const starred = star?.starred ?? false;
  const label = starred ? 'Unstar this decision' : 'Star this decision to come back to it';
  return (
    <button
      className="icon-btn star-btn"
      aria-pressed={starred}
      aria-label={label}
      title={label}
      disabled={!star || save.isPending}
      onClick={() => save.mutate(starred ? { starred: false, note: null } : { starred: true, note: star?.note ?? null })}
    >
      <StarIcon size={16} />
    </button>
  );
}

/** A short note on a starred decision; saved when the field loses focus or on Enter. */
export function StarNote({ handId, decisionId }: { handId: string; decisionId: string }) {
  const { star, save } = useDecisionStar(handId, decisionId);
  const [draft, setDraft] = useState(star?.note ?? '');
  useEffect(() => setDraft(star?.note ?? ''), [star?.note]);
  if (!star?.starred) return null;

  const commit = () => {
    const note = draft.trim() || null;
    if (note !== star.note) save.mutate({ starred: true, note });
  };
  return (
    <div className="star-note">
      <input
        type="text"
        value={draft}
        maxLength={STAR_NOTE_MAX_CHARS}
        placeholder="Add a note for later (optional)"
        aria-label="Note on this starred decision"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      {save.isError && <span className="muted small">Couldn't save the note. Try again.</span>}
    </div>
  );
}
