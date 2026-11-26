# Meta-CRM Full-Stack CRM

## Overview
Meta Lead Ads CRM - Full Stack application with React frontend and Node/Express backend.

## Project Structure
```
meta-crm/
├── package.json              # Root workspace with workspaces: [server, client]
├── .env.example            # Environment variables template
├── .gitignore
├── README.md
├── render.yaml             # Render.com deployment config
├── .github/
│   └── workflows/
│       └── npm-publish.yml # CI: npm install → npm ci(server/client) → build → upload artifacts
└── server/                 # Node/Express API
    └── client/             # React + Vite frontend
```

## CI/CD Pipeline (npm-publish.yml)
- **Root**: `npm install --verbose` (regenerates package-lock.json)
- **Server**: `npm ci --verbose` (correct lockfile)
- **Client**: `npm ci --verbose` (correct lockfile)
- **Tests**: Graceful fallback
- **Build**: npm run build → uploads artifacts
- **Deploy**: Render.com (web API + static-site)

## Dependencies
- **Client**: react@18.3.1, react-dom@18.3.1, @tanstack/react-query@5, @dnd-kit/core, lucide-react, tailwindcss
- **Server**: better-sqlite3@13.2.0, pg@8.11.5, bcryptjs, express, jsonwebtoken, zod

## Local Development
```bash
npm run dev          # Runs both server and client
npm run build        # Builds both workspaces
```

## GitHub Push Status
The Git push from this sandbox environment is blocked due to:
- SSH binary (`ssh`) cannot execute (Android sandbox restriction)
- HTTPS git remote-helper (`git-remote-https`) cannot execute (Android sandbox restriction)
- `git@github.com:` remotes are not viable

To push to GitHub, run from your local terminal:
```bash
cd /storage/emulated/0/Android/data/com.androidharness.app.ci.debug/files/workspace/meta-crm
git remote set-url origin https://github.com/sandyjbkp-coder/meta-lead-CRM-.git
git push -u origin main
```

Or use SSH:
```bash
git remote set-url origin git@github.com:sandyjbkp-coder/meta-lead-CRM-.git
git push -u origin main
```

## Repository Already Created
GitHub repo `sandyjbkp-coder/meta-lead-CRM-` exists and is accessible via API.
