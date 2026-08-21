import { NextApiRequest, NextApiResponse } from 'next';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  return res.status(200).json({
    submission_id: String(req.query.submission_id),
    feedback: [],
    message: '배포 버전은 제출 응답에서 AI 피드백을 바로 반환합니다.',
  });
}
