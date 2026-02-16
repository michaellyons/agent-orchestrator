# Express API with Tests

A simple Express.js REST API with in-memory storage and comprehensive Jest/Supertest test suite.

## Features

- **GET /api/items** - Retrieve all items
- **POST /api/items** - Create a new item
- Error handling middleware (404 and 500 handlers)
- Full test coverage with Jest + Supertest

## Installation

```bash
npm install
```

## Running the Server

### Development Mode
```bash
npm start
```
Server will start on port 3000 (or `process.env.PORT`).

### Test Mode
```bash
npm test
```

### Watch Mode (for development)
```bash
npm run test:watch
```

## API Endpoints

### GET /api/items
Returns a list of all items.

**Response:**
```json
{
  "success": true,
  "data": [
    { "id": 1, "name": "Item 1", "description": "First item" },
    { "id": 2, "name": "Item 2", "description": "Second item" }
  ],
  "count": 2
}
```

### POST /api/items
Creates a new item.

**Request Body:**
```json
{
  "name": "New Item",
  "description": "Optional description"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": { "id": 3, "name": "New Item", "description": "Optional description" },
  "message": "Item created successfully"
}
```

**Error Response (400 Bad Request):**
```json
{
  "success": false,
  "error": "Name is required and must be a non-empty string"
}
```

### 404 Error Handler
Any undefined routes return:
```json
{
  "success": false,
  "error": "Route not found",
  "path": "/api/undefined",
  "method": "GET"
}
```

## Project Structure

```
artifacts/
├── server.js         # Express server with routes
├── server.test.js    # Jest test suite
├── package.json      # Dependencies and scripts
└── README.md         # This file
```

## Dependencies

- **express** - Web framework
- **jest** - Testing framework
- **supertest** - HTTP assertion library

## License

MIT
