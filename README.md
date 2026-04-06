# FraudNet — AI-Powered Fraud & Scam Detection Network

> **Live Demo**: [https://fraud-detection-gules.vercel.app](https://fraud-detection-gules.vercel.app)  
> **Backend API**: [https://fraud-detection-g03j.onrender.com/docs](https://fraud-detection-g03j.onrender.com/docs)

Built for **Devcation Delhi 2026** — TigerGraph Track

---

## What is FraudNet?

FraudNet is a real-time, multi-fraud detection platform that uses **TigerGraph as its core detection engine**. By modeling financial entities (users, accounts, transactions, devices, IP addresses) as a connected graph, FraudNet detects fraud patterns that flat databases simply cannot see — circular money flows, shared device rings, high-frequency structuring, and synthetic identity clusters.

---

## How TigerGraph Powers Detection

TigerGraph is not just a database here — it **is** the detection logic.

### Graph Schema
```
Vertices:  User · Account · Transaction · Device · IPAddress
Edges:     OWNS_ACCOUNT · MADE_TRANSACTION · RECEIVED_BY · USES_DEVICE · CONNECTED_FROM · SHARES_DEVICE
```

### GSQL Queries Running Live
| Query | What It Detects |
|---|---|
| `fraudnet_cycle_detection` | Circular transaction chains A→B→C→A (money laundering) |
| `fraudnet_connected_components` | Isolated fraud rings — clusters of accounts transacting only with each other |
| `fraudnet_degree_centrality` | Hub accounts with abnormally high connection counts (mule accounts) |
| `get_entity_neighborhood` | 2-hop graph traversal for any entity — powers the visual Graph Explorer |

All queries run via TigerGraph Cloud v4.2.2 REST API with bearer token authentication.

---

## Fraud Types Detected

| Type | Detection Method |
|---|---|
| Money Laundering | Graph cycle detection (GSQL) |
| Identity Fraud | Shared device across multiple users (graph traversal) |
| Account Takeover | New account + large transfer + unverified KYC (rule engine) |
| High Frequency / Structuring | Velocity rules — 10+ transactions per hour |
| Fraud Hub / Mule Account | Degree centrality (GSQL) |
| ML Anomaly | Isolation Forest on transaction features |

---

## Detection Architecture

```
CSV Upload / Manual Transaction
        ↓
  Python Backend (FastAPI)
        ↓
  ┌─────────────────────────────────┐
  │         TigerGraph Cloud        │
  │  • Load vertices + edges        │
  │  • Run GSQL cycle detection     │
  │  • Run degree centrality        │
  │  • Run connected components     │
  └─────────────────────────────────┘
        ↓
  ML Layer (Isolation Forest)
        ↓
  Risk Score = Graph Score (40%) + ML Score (40%) + Rules (20%)
        ↓
  Dashboard → Alerts → Graph Visualizer
```

---

## Features

- **Overview Dashboard** — live stats, fraud type breakdown (bar chart), risk distribution (pie chart)
- **Alerts Page** — all flagged entities with risk score, fraud type tags, full explanation
- **Graph Explorer** — visual Cytoscape.js network of any entity's 2-hop neighborhood, powered by TigerGraph
- **Entity Search** — look up any account/user and see their full graph profile
- **CSV Upload** — upload any transaction dataset, instantly analyzed end-to-end
- **Live Transaction Analysis** — submit a single transaction and get a risk score in milliseconds
- **Google OAuth** — secure login via Firebase Authentication

---

## Tech Stack

| Layer | Technology |
|---|---|
| Graph Database | TigerGraph Cloud v4.2.2 |
| Query Language | GSQL (installed queries) |
| Backend | Python, FastAPI, pyTigerGraph |
| ML | scikit-learn (Isolation Forest) |
| Frontend | Next.js 14, TypeScript, Tailwind CSS |
| UI Components | shadcn/ui (Nova), Framer Motion, Recharts |
| Graph Visualization | Cytoscape.js |
| Authentication | Firebase Google OAuth |
| Deployment | Vercel (frontend) + Render (backend) |

---

## Local Setup

### Prerequisites
- Python 3.10+
- Node.js 18+
- TigerGraph Cloud account

### Backend
```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
source venv/bin/activate     # Mac/Linux
pip install -r requirements.txt
```

Create `.env` in `backend/`:
```
TIGERGRAPH_HOST=your-host.i.tgcloud.io
TIGERGRAPH_SECRET=your-secret
TIGERGRAPH_GRAPH=FraudNet
TIGERGRAPH_USERNAME=your-email
FIREBASE_PROJECT_ID=your-firebase-project-id
```

```bash
uvicorn main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
```

Create `.env.local` in `frontend/`:
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Sample Data

Generate realistic fraud data with built-in patterns:
```bash
cd backend
python generate_sample_data.py
```

Upload `sample_data.csv` via the Upload Data page in the dashboard.

---

## Project Structure

```
fraud-detection-network/
├── backend/
│   ├── main.py              # FastAPI app, all endpoints
│   ├── tigergraph.py        # TigerGraph connection + GSQL queries
│   ├── fraud_engine.py      # ML scoring + rule engine
│   ├── generate_sample_data.py
│   └── requirements.txt
└── frontend/
    └── src/
        ├── app/
        │   ├── page.tsx              # Login
        │   └── dashboard/
        │       ├── layout.tsx        # Sidebar + auth guard
        │       ├── page.tsx          # Overview
        │       ├── alerts/page.tsx   # Alerts
        │       ├── graph/page.tsx    # Graph Explorer
        │       ├── entity/page.tsx   # Entity Search
        │       └── upload/page.tsx   # CSV Upload
        └── lib/
            ├── firebase.ts
            └── api.ts
```

---
