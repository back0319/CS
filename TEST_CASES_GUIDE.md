# 문제·테스트 데이터 운영 가이드

현행 스키마는 `problems.test_cases` JSONB 컬럼을 사용하지 않습니다. 문제 본문은 `public.problems`, 각 테스트는 `public.problem_test_cases`의 별도 행으로 관리합니다.

- 브라우저 publishable key는 `status = 'published'` 문제와 `is_sample = true` 테스트만 읽을 수 있어야 합니다.
- 숨은 입력, 기대 출력과 모범답안은 공개 문서, 공개 seed, Git history에 기록하지 않습니다.
- 채점 서버의 secret key만 숨은 테스트를 조회하며, 모범답안은 제출·힌트 경로에서 조회하지 않습니다.
- published 문제는 공개 sample과 숨은 테스트를 각각 하나 이상 가져야 하며, feedback config의 JSON 모양이 런타임 검증을 통과해야 합니다.
- 이미 공개 Git에 기록된 숨은 테스트와 모범답안은 비공개로 되돌아간 것으로 간주하지 말고 운영 값을 새로 생성해 교체합니다.

스키마와 RLS의 기준은 `supabase/migrations/20260715013000_create_problem_catalog.sql`, 애플리케이션 검증 기준은 `frontend/lib/catalog-validation.ts`입니다.
