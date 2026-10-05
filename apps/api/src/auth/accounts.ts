/** Account management that needs Supabase's secret key (server side only). */
export interface AccountAdmin {
  deleteUser(userId: string): Promise<void>;
}

/**
 * Deletes the Supabase auth user; the database's foreign keys then delete the profile, sessions,
 * hands, decisions and coach messages with it.
 */
export function supabaseAccountAdmin(supabaseUrl: string, serviceRoleKey: string): AccountAdmin {
  const base = supabaseUrl.replace(/\/+$/, '');
  return {
    async deleteUser(userId) {
      const res = await fetch(`${base}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
        headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
      });
      if (!res.ok && res.status !== 404) throw new Error(`Supabase refused to delete the account (${res.status}).`);
    },
  };
}
