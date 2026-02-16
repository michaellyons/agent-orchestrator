const request = require('supertest');
const app = require('../server');
const itemsRouter = require('../routes/items');

describe('Express API', () => {
  // Reset items before each test
  beforeEach(() => {
    // Reset the items array to initial state
    itemsRouter._items.length = 0;
    itemsRouter._items.push(
      { id: 1, name: 'Item 1', description: 'First item' },
      { id: 2, name: 'Item 2', description: 'Second item' }
    );
  });

  describe('Health Check', () => {
    test('GET /health should return status ok', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
    });
  });

  describe('GET /api/items', () => {
    test('should return list of items', async () => {
      const response = await request(app)
        .get('/api/items')
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.count).toBe(2);
    });

    test('should return items with correct structure', async () => {
      const response = await request(app)
        .get('/api/items')
        .expect(200);
      
      const item = response.body.data[0];
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('name');
      expect(item).toHaveProperty('description');
    });
  });

  describe('GET /api/items/:id', () => {
    test('should return a single item by ID', async () => {
      const response = await request(app)
        .get('/api/items/1')
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id', 1);
      expect(response.body.data).toHaveProperty('name', 'Item 1');
    });

    test('should return 404 for non-existent item', async () => {
      const response = await request(app)
        .get('/api/items/999')
        .expect(404);
      
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('not found');
    });

    test('should return 400 for invalid ID format', async () => {
      const response = await request(app)
        .get('/api/items/invalid')
        .expect(400);
      
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('Invalid ID format');
    });
  });

  describe('POST /api/items', () => {
    test('should create a new item', async () => {
      const newItem = {
        name: 'New Item',
        description: 'A brand new item'
      };

      const response = await request(app)
        .post('/api/items')
        .send(newItem)
        .expect(201);
      
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data.name).toBe('New Item');
      expect(response.body.data.description).toBe('A brand new item');
      expect(response.body.message).toBe('Item created successfully');
    });

    test('should create item with minimal data (name only)', async () => {
      const newItem = {
        name: 'Minimal Item'
      };

      const response = await request(app)
        .post('/api/items')
        .send(newItem)
        .expect(201);
      
      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe('Minimal Item');
      expect(response.body.data.description).toBe('');
    });

    test('should return 400 when name is missing', async () => {
      const response = await request(app)
        .post('/api/items')
        .send({ description: 'No name provided' })
        .expect(400);
      
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('Name is required');
    });

    test('should return 400 when name is empty string', async () => {
      const response = await request(app)
        .post('/api/items')
        .send({ name: '   ' })
        .expect(400);
      
      expect(response.body.success).toBe(false);
    });

    test('should return 400 when name is not a string', async () => {
      const response = await request(app)
        .post('/api/items')
        .send({ name: 123 })
        .expect(400);
      
      expect(response.body.success).toBe(false);
    });

    test('should trim whitespace from name', async () => {
      const response = await request(app)
        .post('/api/items')
        .send({ name: '  Trimmed Item  ' })
        .expect(201);
      
      expect(response.body.data.name).toBe('Trimmed Item');
    });
  });

  describe('Error Handling', () => {
    test('should return 404 for undefined routes', async () => {
      const response = await request(app)
        .get('/api/undefined-route')
        .expect(404);
      
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('Not Found');
    });

    test('should include error status in response', async () => {
      const response = await request(app)
        .get('/api/items/999')
        .expect(404);
      
      expect(response.body.error).toHaveProperty('status', 404);
    });
  });
});
