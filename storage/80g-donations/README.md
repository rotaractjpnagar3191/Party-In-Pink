# 80G Donations Storage

This directory stores all 80G donation form submissions.

## File Structure
Each submission is stored as a JSON file with the naming pattern:
`80G_{timestamp}_{randomId}.json`

## Data Structure
```json
{
  "id": "80G_1234567890_abc12345",
  "type": "80g_donation",
  "timestamp": "2025-11-18T10:30:00.000Z",
  "status": "submitted",
  "donor": {
    "name": "Full Name",
    "pan": "ABCDE1234F",
    "email": "donor@example.com",
    "phone": "+919876543210",
    "address": "Complete postal address"
  },
  "donation": {
    "amount": 5000,
    "payment_method": "upi",
    "transaction_id": "UPI123456789",
    "transaction_date": "2025-11-18",
    "consent": true
  },
  "processing": {
    "receipt_status": "pending",
    "receipt_issued_date": null,
    "notes": ""
  }
}
```

## Status Values
- `submitted`: Initial submission received
- `verified`: Payment verified in bank account
- `processing`: 80G receipt being prepared
- `completed`: Receipt issued and sent
- `rejected`: Submission rejected (with reason in notes)

## Processing Workflow
1. Form submission creates file with status "submitted"
2. Admin verifies payment and updates status to "verified"
3. 80G receipt is prepared and status updated to "processing"
4. Receipt is issued and sent, status updated to "completed"