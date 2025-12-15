# FCM Message Delivery Tracking

This guide explains how to track whether FCM notifications were received by the device.

## How It Works

1. **Message Sent**: When you send a message via `/api/send-sms`, a record is created in the database with status `PENDING`
2. **FCM Confirmation**: After FCM accepts the message, status changes to `SENT`
3. **App Acknowledgment**: The Flutter app should call `/api/acknowledge-message/:messageId` after receiving and processing the notification
4. **Status Tracking**: You can check message status at any time using the status endpoints

## Message Statuses

- `PENDING` - Message created, waiting to be sent
- `SENT` - FCM accepted the message (doesn't guarantee delivery)
- `DELIVERED` - FCM confirmed delivery (if available)
- `ACKNOWLEDGED` - Flutter app confirmed receipt and processing
- `FAILED` - Message failed to send

## API Endpoints

### 1. Check Message Status

**GET** `/api/message-status/:messageId`

Check the current status of a specific message.

**Example:**
```bash
curl http://localhost:3000/api/message-status/507f1f77bcf86cd799439011
```

**Response:**
```json
{
  "success": true,
  "message": {
    "id": "507f1f77bcf86cd799439011",
    "phoneNumber": "0771234567",
    "status": "acknowledged",
    "message": "Your booking is confirmed",
    "fcmMessageId": "projects/myproject/messages/0:1234567890",
    "sentAt": "2025-12-02T10:30:00.000Z",
    "acknowledgedAt": "2025-12-02T10:30:05.000Z",
    "error": null,
    "createdAt": "2025-12-02T10:30:00.000Z"
  }
}
```

### 2. Acknowledge Message Receipt

**POST** `/api/acknowledge-message/:messageId`

Called by the Flutter app to confirm message receipt. The `messageId` is included in the FCM data payload.

**Example:**
```bash
curl -X POST http://localhost:3000/api/acknowledge-message/507f1f77bcf86cd799439011
```

**Response:**
```json
{
  "success": true,
  "message": "Message acknowledged successfully"
}
```

### 3. Get Message History

**GET** `/api/message-history/:phoneNumber?limit=50`

Get all messages sent to a phone number.

**Example:**
```bash
curl "http://localhost:3000/api/message-history/0771234567?limit=20"
```

**Response:**
```json
{
  "success": true,
  "count": 20,
  "messages": [
    {
      "id": "507f1f77bcf86cd799439011",
      "phoneNumber": "0771234567",
      "status": "acknowledged",
      "message": "Your booking is confirmed",
      "fcmMessageId": "projects/myproject/messages/0:1234567890",
      "sentAt": "2025-12-02T10:30:00.000Z",
      "acknowledgedAt": "2025-12-02T10:30:05.000Z",
      "createdAt": "2025-12-02T10:30:00.000Z"
    }
  ]
}
```

### 4. Get Delivery Statistics

**GET** `/api/delivery-stats/:phoneNumber`

Get aggregated statistics about message delivery.

**Example:**
```bash
curl http://localhost:3000/api/delivery-stats/0771234567
```

**Response:**
```json
{
  "success": true,
  "phoneNumber": "0771234567",
  "stats": {
    "total": 100,
    "sent": 95,
    "delivered": 90,
    "acknowledged": 85,
    "failed": 5
  }
}
```

## Flutter App Integration

### 1. Extract Message ID from FCM Data

When your Flutter app receives an FCM message, extract the `messageId` from the data payload:

```dart
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  final phone = message.data['phone'];
  final messageText = message.data['message'];
  final messageId = message.data['messageId']; // Database message ID
  
  // Send SMS using your SMS service
  final smsSent = await sendSMS(phone: phone, message: messageText);
  
  // Acknowledge receipt to backend
  if (smsSent && messageId != null) {
    await http.post(
      Uri.parse('http://your-api/api/acknowledge-message/$messageId'),
    );
  }
}
```

### 2. Handle Foreground Messages

```dart
FirebaseMessaging.onMessage.listen((RemoteMessage message) async {
  final phone = message.data['phone'];
  final messageText = message.data['message'];
  final messageId = message.data['messageId'];
  
  // Show notification
  // Send SMS
  final smsSent = await sendSMS(phone: phone, message: messageText);
  
  // Acknowledge receipt
  if (smsSent && messageId != null) {
    await http.post(
      Uri.parse('http://your-api/api/acknowledge-message/$messageId'),
    );
  }
});
```

## Checking Delivery Status

### After Sending a Message

When you send a message, you'll receive a `dbMessageId` in the response:

```json
{
  "success": true,
  "messageId": "projects/myproject/messages/0:1234567890",
  "dbMessageId": "507f1f77bcf86cd799439011",
  "message": "FCM message sent successfully..."
}
```

Use this `dbMessageId` to check status:

```bash
# Check status
curl http://localhost:3000/api/message-status/507f1f77bcf86cd799439011

# Wait a few seconds, then check again
# Status should change from "sent" to "acknowledged" if app received it
```

## Example Workflow

1. **Send Message:**
   ```bash
   curl -X POST http://localhost:3000/api/send-sms \
     -H "Content-Type: application/json" \
     -d '{
       "phone": "0771234567",
       "message": "Your booking is confirmed"
     }'
   ```
   
   Response includes `dbMessageId`: `"507f1f77bcf86cd799439011"`

2. **Check Status Immediately:**
   ```bash
   curl http://localhost:3000/api/message-status/507f1f77bcf86cd799439011
   ```
   
   Status: `"sent"` (FCM accepted the message)

3. **Flutter App Receives Message:**
   - App extracts `messageId` from FCM data
   - App sends SMS
   - App calls `/api/acknowledge-message/507f1f77bcf86cd799439011`

4. **Check Status Again:**
   ```bash
   curl http://localhost:3000/api/message-status/507f1f77bcf86cd799439011
   ```
   
   Status: `"acknowledged"` (App confirmed receipt)

## Monitoring

### Check All Messages for a Phone

```bash
curl "http://localhost:3000/api/message-history/0771234567?limit=10"
```

### Get Delivery Statistics

```bash
curl http://localhost:3000/api/delivery-stats/0771234567
```

This shows:
- Total messages sent
- Successfully sent
- Delivered (if FCM provides this)
- Acknowledged by app
- Failed messages

## Notes

- **FCM Status**: FCM only confirms that it accepted the message (`SENT`), not that it was delivered to the device
- **App Acknowledgment**: The `ACKNOWLEDGED` status is the most reliable indicator that the app received and processed the message
- **Timeout**: Consider implementing a timeout mechanism - if a message isn't acknowledged within X minutes, mark it as potentially failed
- **Retry Logic**: You can implement retry logic based on message status





























