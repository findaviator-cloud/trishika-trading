# Angel One Historical Candle Contract Notes

## Source

- Documentation URL: https://smartapi.angelone.in/docs/
- Documentation retrieval date: 2026-09-09
- Account-specific entitlement: NOT VERIFIED

## Historical Candle Endpoint

- HTTP method: POST
- Endpoint: https://apiconnect.angelone.in/rest/secure/angelbroking/historical/v1/getCandleData

## Request Headers

Documented headers:

- Authorization: Bearer <ACCESS_TOKEN>
- X-PrivateKey: <API_KEY>
- Content-Type: application/json
- Accept: application/json
- X-UserType: USER
- X-SourceID: WEB
- X-ClientLocalIP: <CLIENT_LOCAL_IP>
- X-ClientPublicIP: <CLIENT_PUBLIC_IP>
- X-MACAddress: <MAC_ADDRESS>

No real credentials, tokens, PINs, TOTP values, IP values, or MAC values belong in this file.

## Request Body

Required fields:

- exchange
- symboltoken
- interval
- fromdate
- todate

Example shape:

```json
{
  "exchange": "NSE",
  "symboltoken": "<SYMBOL_TOKEN>",
  "interval": "ONE_HOUR",
  "fromdate": "YYYY-MM-DD HH:mm",
  "todate": "YYYY-MM-DD HH:mm"
}
```

## Time Contract

- Request time format: `yyyy-MM-dd HH:mm`
- Documented candle timestamp form: ISO 8601 with `+05:30`
- Interpretation: timestamps must be parsed as offset-aware instants and normalized to epoch milliseconds.

## Supported Intervals

- ONE_MINUTE
- THREE_MINUTE
- FIVE_MINUTE
- TEN_MINUTE
- FIFTEEN_MINUTE
- THIRTY_MINUTE
- ONE_HOUR
- ONE_DAY

## Documented Maximum Window Per Request

- ONE_MINUTE: 30 days
- THREE_MINUTE: 60 days
- FIVE_MINUTE: 100 days
- TEN_MINUTE: 100 days
- FIFTEEN_MINUTE: 200 days
- THIRTY_MINUTE: 200 days
- ONE_HOUR: 400 days
- ONE_DAY: 2000 days

## Response Contract

Successful response envelope:

```json
{
  "status": true,
  "message": "SUCCESS",
  "errorcode": "",
  "data": [
    [
      "<timestamp>",
      "<open>",
      "<high>",
      "<low>",
      "<close>",
      "<volume>"
    ]
  ]
}
```

Each candle is:

```text
[timestamp, open, high, low, close, volume]
```

## Instrument Status

### NIFTY

- exchange: NSE
- symboltoken: 99926000
- Historical API status: verified by public documentation example
- Trading approval: false
- Execution allowed: false

### BANKNIFTY

- exchange: TBD
- symboltoken: TBD
- Historical API status: not verified
- Trading approval: false
- Execution allowed: false

### SENSEX

- exchange: TBD
- symboltoken: TBD
- Historical API status: not verified
- Trading approval: false
- Execution allowed: false

## Scope Boundary

Research market data only.

Excluded:

- Portfolio access
- Funds/RMS access
- Positions access
- Order placement
- Order modification
- Order cancellation
- Automated trading
- Live-capital trading
- Execution
