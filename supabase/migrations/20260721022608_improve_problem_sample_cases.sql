-- 각 문제의 성격이 잘 드러나는 두 테스트를 공개 입출력 예시로 지정합니다.

update public.problem_test_cases
set is_sample = false,
    explanation = null
where problem_id in (
  select id
  from public.problems
  where slug in (
    'add-two-numbers',
    'even-or-odd',
    'maximum-of-three',
    'sum-one-to-n',
    'multiplication-table',
    'factorial',
    'digit-sum',
    'prime-check',
    'greatest-common-divisor',
    'fibonacci-number',
    'reverse-string',
    'palindrome-check',
    'character-frequency',
    'index-of-maximum',
    'unique-in-order',
    'two-sum-indices',
    'bubble-sort',
    'binary-search',
    'valid-parentheses',
    'maximum-subarray'
  )
);

with selected_samples (slug, case_order) as (
  values
    ('add-two-numbers', 1), ('add-two-numbers', 7),
    ('even-or-odd', 1), ('even-or-odd', 5),
    ('maximum-of-three', 1), ('maximum-of-three', 2),
    ('sum-one-to-n', 5), ('sum-one-to-n', 7),
    ('multiplication-table', 1), ('multiplication-table', 7),
    ('factorial', 1), ('factorial', 7),
    ('digit-sum', 1), ('digit-sum', 7),
    ('prime-check', 1), ('prime-check', 8),
    ('greatest-common-divisor', 1), ('greatest-common-divisor', 7),
    ('fibonacci-number', 1), ('fibonacci-number', 7),
    ('reverse-string', 2), ('reverse-string', 8),
    ('palindrome-check', 1), ('palindrome-check', 2),
    ('character-frequency', 1), ('character-frequency', 6),
    ('index-of-maximum', 1), ('index-of-maximum', 2),
    ('unique-in-order', 1), ('unique-in-order', 5),
    ('two-sum-indices', 1), ('two-sum-indices', 4),
    ('bubble-sort', 1), ('bubble-sort', 2),
    ('binary-search', 1), ('binary-search', 2),
    ('valid-parentheses', 1), ('valid-parentheses', 2),
    ('maximum-subarray', 1), ('maximum-subarray', 2)
)
update public.problem_test_cases as test_case
set is_sample = true,
    explanation = solution.explanation
from selected_samples as sample
join public.problems as problem
  on problem.slug = sample.slug
join public.problem_solutions as solution
  on solution.problem_id = problem.id
 and solution.language = 'python'
where test_case.problem_id = problem.id
  and test_case.case_order = sample.case_order;
