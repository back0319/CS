import type { NextApiRequest, NextApiResponse } from 'next';
import { getPublicSupabaseClient } from '../../../lib/supabase';

type KeepaliveResponse = {
  ok: boolean;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<KeepaliveResponse>,
) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ ok: false });
  }

  try {
    const { error } = await getPublicSupabaseClient()
      .from('problems')
      .select('id')
      .eq('status', 'published')
      .limit(1);

    if (error) throw error;

    return res.status(200).json({ ok: true });
  } catch {
    console.error('Supabase keepalive query failed.');
    return res.status(503).json({ ok: false });
  }
}
