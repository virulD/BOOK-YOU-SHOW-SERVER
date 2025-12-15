# FCM Messaging Service

This service provides FCM v1 API integration for sending push notifications to Flutter apps. The Flutter app receives the notification in the background and handles sending SMS messages.

## Setup

1. **Firebase Configuration**: Ensure `FIREBASE_SERVICE_ACCOUNT_PATH` is set in your `server.env` file:
   ```env
   FIREBASE_SERVICE_ACCOUNT_PATH=./src/firebase-message/myclinic-smsgateway-firebase-adminsdk-fbsvc-ab070d7a0d.json
   ```

2. **Database**: The service uses MongoDB to store device tokens. The `DeviceToken` schema is automatically registered.

## API Endpoints

### 1. Send SMS via FCM (`POST /api/send-sms`)

Sends a push notification to a Flutter app with phone and message data.

**Request Body:**
```json
{
  "phone": "0771234567",
  "message": "Your booking is confirmed. Thank you!",
  "fcmToken": "optional-token-if-not-in-db"
}
```

**Response (Success):**
```json
{
  "success": true,
  "messageId": "projects/myproject/messages/0:1234567890",
  "message": "FCM message sent successfully. The Flutter app will handle sending the SMS."
}
```

**Response (Error):**
```json
{
  "statusCode": 400,
  "message": "No FCM token found for phone number: 0771234567"
}
```

### 2. Register Device Token (`POST /api/register-device-token`)

Registers or updates an FCM token for a phone number.

**Request Body:**
```json
{
  "phoneNumber": "0771234567",
  "fcmToken": "dGhpcyBpcyBhIGZha2UgZmNtIHRva2Vu...",
  "deviceInfo": "iPhone 13, iOS 16.0"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Device token registered successfully",
  "deviceToken": {
    "phoneNumber": "0771234567",
    "isActive": true,
    "lastUsedAt": "2025-12-02T10:30:00.000Z"
  }
}
```

## Example Usage

### Using cURL

**Send SMS:**
```bash
curl -X POST http://localhost:3000/api/send-sms \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "0771234567",
    "message": "Your booking is confirmed. Seats: A1, A2. Thank you!"
  }'
```

**Register Device Token:**
```bash
curl -X POST http://localhost:3000/api/register-device-token \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "0771234567",
    "fcmToken": "your-fcm-token-here",
    "deviceInfo": "Flutter App v1.0.0"
  }'
```

### Using JavaScript/TypeScript

```typescript
// Send SMS
const response = await fetch('http://localhost:3000/api/send-sms', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    phone: '0771234567',
    message: 'Your booking is confirmed. Thank you!',
  }),
});

const result = await response.json();
console.log(result);
```

### Using Postman

1. Create a new POST request to `http://localhost:3000/api/send-sms`
2. Set Headers: `Content-Type: application/json`
3. Set Body (raw JSON):
   ```json
   {
     "phone": "0771234567",
     "message": "Your booking is confirmed. Thank you!"
   }
   ```
4. Send the request

## Flutter App Integration

The Flutter app should:

1. **Register FCM Token**: When the app starts, register the FCM token:
   ```dart
   // Get FCM token
   String? token = await FirebaseMessaging.instance.getToken();
   
   // Register with backend
   await http.post(
     Uri.parse('http://your-api/api/register-device-token'),
     headers: {'Content-Type': 'application/json'},
     body: jsonEncode({
       'phoneNumber': userPhoneNumber,
       'fcmToken': token,
       'deviceInfo': 'Flutter App ${packageInfo.version}',
     }),
   );
   ```

2. **Handle Background Messages**: Set up a background message handler:
   ```dart
   @pragma('vm:entry-point')
   Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
     final phone = message.data['phone'];
     final messageText = message.data['message'];
     
     // Send SMS using your SMS service
     await sendSMS(phone: phone, message: messageText);
   }
   
   // Register handler
   FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
   ```

3. **Handle Foreground Messages**: Handle messages when app is in foreground:
   ```dart
   FirebaseMessaging.onMessage.listen((RemoteMessage message) {
     final phone = message.data['phone'];
     final messageText = message.data['message'];
     
     // Show notification and send SMS
     sendSMS(phone: phone, message: messageText);
   });
   ```

## Error Handling

The service handles common FCM errors:

- **Invalid Token**: Automatically deactivates the token in the database
- **Unregistered Token**: Marks token as inactive
- **Service Unavailable**: Returns appropriate error message
- **Invalid Arguments**: Validates and returns error details

## Database Schema

The `DeviceToken` collection stores:
- `phoneNumber`: Unique phone number
- `fcmToken`: FCM device token
- `isActive`: Whether the token is active
- `deviceInfo`: Optional device information
- `lastUsedAt`: Last time the token was used
- `createdAt`: Token creation timestamp
- `updatedAt`: Last update timestamp

## Notes

- If `fcmToken` is not provided in the request, the service will look it up in the database using the phone number
- Tokens are automatically deactivated if they become invalid
- The service uses FCM v1 API format (not the deprecated legacy API)
- Messages include both `data` payload (for background handling) and `notification` payload (for foreground display)





























