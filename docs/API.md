# Local HTTP API

This document specifies the local HTTP API that Valute will expose for inter-application communication. The API runs on `localhost` and is intended for local integrations, extensions, and tools like MCP servers or personal automation scripts.

**Status:** Planned for a future release. Not yet implemented.

---

## Design Principles

1. **Local-only** -- The API binds to `127.0.0.1` (localhost) only. It is never exposed to the network.
2. **No authentication for v1** -- Since the API is local-only and accessible only from the same machine, no auth is required in the initial version. Future versions may add a local token for multi-user machines.
3. **REST + JSON** -- Standard RESTful conventions with JSON request and response bodies.
4. **Consistent error format** -- All errors return a standard JSON shape with an error code and message.
5. **Money in centavos** -- All monetary amounts in the API are integers representing centavos/cents, matching the database convention.
6. **IDs are ULIDs** -- All entity IDs are ULID strings.

---

## Base URL

```
http://127.0.0.1:7878/api/v1
```

The port `7878` is configurable in Valute settings.

---

## Common Response Format

### Success

```json
{
  "data": { ... },
  "meta": {
    "total": 42,
    "page": 1,
    "per_page": 20
  }
}
```

For single-entity responses, `meta` is omitted:

```json
{
  "data": { ... }
}
```

### Error

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Transaction with ID 01HXXXXXX not found."
  }
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Request body failed validation |
| `NOT_FOUND` | 404 | Entity does not exist |
| `CONFLICT` | 409 | Duplicate or constraint violation |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

---

## Endpoints

### Accounts

#### List accounts

```
GET /api/v1/accounts
```

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `type` | string | all | Filter by account type |
| `include_archived` | boolean | false | Include archived accounts |

**Response:**

```json
{
  "data": [
    {
      "id": "01HXYZ...",
      "name": "Chase Checking",
      "type": "checking",
      "currency": "USD",
      "balance": 250000,
      "icon": "building-2",
      "color": "#3b82f6",
      "is_archived": false,
      "created_at": "2025-01-15T10:30:00.000Z",
      "updated_at": "2025-01-20T14:00:00.000Z"
    }
  ],
  "meta": { "total": 3 }
}
```

#### Get account

```
GET /api/v1/accounts/:id
```

#### Create account

```
POST /api/v1/accounts
```

**Request body:**

```json
{
  "name": "Savings Account",
  "type": "savings",
  "currency": "USD",
  "balance": 0,
  "icon": "piggy-bank",
  "color": "#22c55e"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Account display name |
| `type` | string | yes | One of: `checking`, `savings`, `credit_card`, `cash`, `investment`, `crypto`, `other` |
| `currency` | string | no | ISO 4217 code. Default: `USD` |
| `balance` | integer | no | Initial balance in centavos. Default: `0` |
| `icon` | string | no | Lucide icon name |
| `color` | string | no | Hex color code |

#### Update account

```
PATCH /api/v1/accounts/:id
```

All fields are optional. Only provided fields are updated.

#### Archive account

```
POST /api/v1/accounts/:id/archive
```

#### Unarchive account

```
POST /api/v1/accounts/:id/unarchive
```

---

### Transactions

#### List transactions

```
GET /api/v1/transactions
```

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `account_id` | string | all | Filter by account |
| `category_id` | string | all | Filter by category |
| `type` | string | all | Filter by `expense`, `income`, or `transfer` |
| `start_date` | string | none | Start of date range (YYYY-MM-DD) |
| `end_date` | string | none | End of date range (YYYY-MM-DD) |
| `search` | string | none | Search description and notes |
| `tags` | string | none | Comma-separated tag filter |
| `page` | integer | 1 | Page number |
| `per_page` | integer | 20 | Results per page (max 100) |
| `sort` | string | `-date` | Sort field. Prefix `-` for descending |

**Response:**

```json
{
  "data": [
    {
      "id": "01HXYZ...",
      "account_id": "01HABC...",
      "category_id": "01FOOD...",
      "subcategory_id": null,
      "type": "expense",
      "amount": 4500,
      "currency": "USD",
      "description": "Groceries at Whole Foods",
      "notes": null,
      "date": "2025-01-20",
      "tags": ["groceries", "weekly"],
      "is_recurring": false,
      "transfer_to_account_id": null,
      "created_at": "2025-01-20T18:30:00.000Z",
      "updated_at": "2025-01-20T18:30:00.000Z"
    }
  ],
  "meta": {
    "total": 156,
    "page": 1,
    "per_page": 20
  }
}
```

**Note:** The `tags` field in the response is deserialized from the JSON string into an actual array.

#### Get transaction

```
GET /api/v1/transactions/:id
```

#### Create transaction

```
POST /api/v1/transactions
```

**Request body:**

```json
{
  "account_id": "01HABC...",
  "type": "expense",
  "amount": 4500,
  "description": "Groceries",
  "category_id": "01FOOD...",
  "date": "2025-01-20",
  "tags": ["groceries"],
  "notes": "Weekly grocery run"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `account_id` | string | yes | Source account ULID |
| `type` | string | yes | One of: `expense`, `income`, `transfer` |
| `amount` | integer | yes | Amount in centavos (positive) |
| `description` | string | yes | Transaction description |
| `currency` | string | no | ISO 4217 code. Default: account currency |
| `category_id` | string | no | Category ULID |
| `subcategory_id` | string | no | Subcategory ULID |
| `date` | string | no | YYYY-MM-DD. Default: today |
| `tags` | string[] | no | Array of tag strings |
| `notes` | string | no | Additional notes |
| `is_recurring` | boolean | no | Default: false |
| `transfer_to_account_id` | string | no | Required if type is `transfer` |

The API automatically updates the account balance after creating a transaction.

#### Update transaction

```
PATCH /api/v1/transactions/:id
```

#### Delete transaction

```
DELETE /api/v1/transactions/:id
```

Deleting a transaction reverses the account balance change.

---

### Categories

#### List categories

```
GET /api/v1/categories
```

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `type` | string | all | Filter by `expense`, `income`, or `transfer` |

#### Get category with subcategories

```
GET /api/v1/categories/:id
```

Response includes a `subcategories` array.

#### Create category

```
POST /api/v1/categories
```

```json
{
  "name": "Pets",
  "type": "expense",
  "icon": "paw-print",
  "color": "#f97316"
}
```

#### Create subcategory

```
POST /api/v1/categories/:id/subcategories
```

```json
{
  "name": "Vet visits"
}
```

---

### Budgets

#### List budgets

```
GET /api/v1/budgets
```

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `is_active` | boolean | true | Filter by active status |
| `include_status` | boolean | false | Include current period spending data |

When `include_status=true`, each budget includes a `current_period` object:

```json
{
  "data": [
    {
      "id": "01HXYZ...",
      "category_id": "01FOOD...",
      "name": "Food Budget",
      "amount": 50000,
      "period": "monthly",
      "is_active": true,
      "current_period": {
        "start_date": "2025-01-01",
        "end_date": "2025-01-31",
        "spent": 32500,
        "remaining": 17500,
        "percent_used": 65
      }
    }
  ]
}
```

#### Create budget

```
POST /api/v1/budgets
```

```json
{
  "category_id": "01FOOD...",
  "name": "Food Budget",
  "amount": 50000,
  "period": "monthly"
}
```

#### Update budget

```
PATCH /api/v1/budgets/:id
```

#### Delete budget

```
DELETE /api/v1/budgets/:id
```

---

### Subscriptions

#### List subscriptions

```
GET /api/v1/subscriptions
```

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `is_active` | boolean | true | Filter by active status |
| `upcoming_days` | integer | none | Only show subscriptions billing within N days |

#### Create subscription

```
POST /api/v1/subscriptions
```

```json
{
  "name": "Netflix",
  "amount": 1599,
  "currency": "USD",
  "billing_cycle": "monthly",
  "next_billing_date": "2025-02-15",
  "account_id": "01HABC...",
  "category_id": "01SUBSCRIPT...",
  "url": "https://netflix.com"
}
```

#### Update subscription

```
PATCH /api/v1/subscriptions/:id
```

#### Cancel subscription

```
POST /api/v1/subscriptions/:id/cancel
```

Sets `is_active` to 0.

---

### Investments

#### List investments

```
GET /api/v1/investments
```

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `account_id` | string | all | Filter by investment account |
| `type` | string | all | Filter by `stock`, `etf`, `crypto`, etc. |
| `include_prices` | boolean | false | Include latest price data |

#### Create investment

```
POST /api/v1/investments
```

```json
{
  "account_id": "01HINV...",
  "symbol": "AAPL",
  "name": "Apple Inc.",
  "type": "stock",
  "shares": 10.0,
  "avg_cost_basis": 17500,
  "currency": "USD"
}
```

#### Update investment

```
PATCH /api/v1/investments/:id
```

#### Delete investment

```
DELETE /api/v1/investments/:id
```

#### Get portfolio summary

```
GET /api/v1/investments/summary
```

Returns aggregate portfolio statistics:

```json
{
  "data": {
    "total_market_value": 1250000,
    "total_cost_basis": 1100000,
    "total_gain_loss": 150000,
    "total_gain_loss_percent": 13.6,
    "by_type": {
      "stock": { "market_value": 800000, "gain_loss": 100000 },
      "etf": { "market_value": 450000, "gain_loss": 50000 }
    }
  }
}
```

---

### Summary

#### Financial overview

```
GET /api/v1/summary
```

Returns a high-level financial snapshot:

```json
{
  "data": {
    "net_worth": 3500000,
    "total_assets": 4000000,
    "total_liabilities": 500000,
    "monthly_income": 500000,
    "monthly_expenses": 245000,
    "monthly_savings_rate": 51.0,
    "accounts_count": 4,
    "active_budgets_count": 3,
    "active_subscriptions_count": 7,
    "monthly_subscription_cost": 8500,
    "portfolio_value": 1250000
  }
}
```

#### Spending summary

```
GET /api/v1/summary/spending
```

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `period` | string | `month` | One of: `week`, `month`, `year`, `custom` |
| `start_date` | string | auto | Required for `custom` period |
| `end_date` | string | auto | Required for `custom` period |

Returns the same data shape as the `getSpendingSummary` AI tool.

---

### Exchange Rates

#### Get latest rate

```
GET /api/v1/exchange-rates/:from/:to
```

Returns the most recent exchange rate for a currency pair.

```json
{
  "data": {
    "from_currency": "USD",
    "to_currency": "MXN",
    "rate": 17.25,
    "date": "2025-01-20"
  }
}
```

#### Update rate

```
POST /api/v1/exchange-rates
```

```json
{
  "from_currency": "USD",
  "to_currency": "MXN",
  "rate": 17.25,
  "date": "2025-01-20"
}
```

---

### Settings

#### Get all settings

```
GET /api/v1/settings
```

#### Get setting

```
GET /api/v1/settings/:key
```

#### Set setting

```
PUT /api/v1/settings/:key
```

```json
{
  "value": "dark"
}
```

---

## Pagination

List endpoints support cursor-based pagination:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | integer | 1 | Page number (1-indexed) |
| `per_page` | integer | 20 | Items per page (max 100) |

The `meta` object in the response includes `total`, `page`, and `per_page`.

---

## Future Considerations

### Authentication (v2)

For multi-user machines or remote access scenarios, a future version may add:

- A locally-generated bearer token stored in the Tauri app data directory.
- Token passed via `Authorization: Bearer <token>` header.
- Token rotation through the Settings UI.

### WebSocket Events (v2)

For real-time integrations:

```
ws://127.0.0.1:7878/api/v1/events
```

Events:

```json
{ "type": "transaction.created", "data": { "id": "01HXYZ..." } }
{ "type": "account.balance_changed", "data": { "id": "01HABC...", "balance": 250000 } }
{ "type": "budget.threshold_reached", "data": { "id": "01HBUD...", "percent": 90 } }
```

### MCP Server (v2)

The local API can be wrapped as an MCP (Model Context Protocol) server, allowing any MCP-compatible AI agent to interact with Valute's financial data.
