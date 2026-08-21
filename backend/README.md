# Legacy FastAPI/DMOJ research prototype

This directory is not part of the DidimCode production runtime. Production is the Next.js application under `frontend/` and executes untrusted Python only through Vercel Sandbox.

The code here is retained for research history and includes execution paths that do not meet the production isolation contract. Do not deploy it or expose its API routes. The root Compose files require the explicit `legacy-research` profile to prevent accidental startup.
