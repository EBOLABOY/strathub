# Frontend MVP Logic Integration - Walkthrough

## Environment Setup

### Terminal 1: Backend (Port 3000)
```bash
cd packages/api
PORT=3000 npm run dev
```

### Terminal 2: Frontend (Port 3001)
```bash
cd packages/web
npm run dev -- -p 3001
# OR for production:
npm run build && npm run start -- -p 3001
```

> [!IMPORTANT]
> - Backend: `http://localhost:3000`
> - Frontend: `http://localhost:3001`
> - Next.js rewrites `/api/*` → `http://localhost:3000/api/*` (see `next.config.ts`)

---

## Verification Flow

### 1. Register & Login
```bash
# Register
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'
# Copy the token from response
```

### 2. Create Exchange Account
```bash
curl -X POST http://localhost:3000/api/accounts \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Testnet","exchange":"binance","apiKey":"mock","secret":"mock","isTestnet":true}'
# Expected: 201 with {id, name, exchange, isTestnet, createdAt}
```

### 3. Create Bot (UI Flow)
1. Open `http://localhost:3001/bots/new`
2. Select account from dropdown (or click "Test Acc" button)
3. Default config has `orderQuantity: "1"` (passes min notional)
4. Click "Create Draft Bot" → Redirects to `/bots`

### 4. Preview & Start
1. Click the new bot card → Detail Page
2. Click "Preview":
   - If config valid: Green "Configuration valid"
   - If issues: Red (ERROR) / Yellow (WARNING) indicators
3. Click "Start"

### 5. Accounts Management (UI)
1. Navigate to `http://localhost:3001/settings/accounts`
2. Click "Add Account"
3. Fill form (name, exchange, keys, testnet checkbox)
4. Verify account appears in list
5. Try delete → If account has bots: 409 error shown

### 6. M3B: Mainnet Account Creation
```bash
# Step 1: Set encryption key (32 bytes base64)
export CREDENTIALS_ENCRYPTION_KEY=$(openssl rand -base64 32)

# Step 2: Create mainnet account (now allowed!)
curl -X POST http://localhost:3000/api/accounts \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Mainnet","exchange":"binance","apiKey":"real-key","secret":"real-secret","isTestnet":false}'
# Expected: 201 Created

# Without encryption key → 403 MAINNET_ACCOUNT_FORBIDDEN
```

### 7. Migration Script
```bash
# Migrate existing plaintext credentials to encrypted format
# Prerequisites: CREDENTIALS_ENCRYPTION_KEY set, M3B deployed
cd packages/api
CREDENTIALS_ENCRYPTION_KEY=<your-key> npx tsx scripts/migrate-credentials.ts
```

---

## Verification Checklist

| Feature | Expected Result |
|---------|-----------------|
| `npm test` | All passed |
| `npm run build -w packages/web` | Exit code 0 |
| `/api/accounts` GET | Returns sanitized DTO (no credentials) |
| `/api/accounts` POST (testnet) | 201 success |
| `/api/accounts` POST (mainnet + key) | 201 success, encrypted |
| `/api/accounts` POST (mainnet - key) | 403 MAINNET_ACCOUNT_FORBIDDEN |
| `/api/accounts/:id` DELETE | 204 success, 409 if has bots |
| Settings → Accounts | List, Create, Delete with confirmation |
