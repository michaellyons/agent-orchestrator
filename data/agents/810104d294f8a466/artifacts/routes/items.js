const express = require('express');
const router = express.Router();

// In-memory items store (would be a database in production)
let items = [
  { id: 1, name: 'Item 1', description: 'First item' },
  { id: 2, name: 'Item 2', description: 'Second item' }
];

// Helper to get next ID
const getNextId = () => {
  return items.length > 0 ? Math.max(...items.map(i => i.id)) + 1 : 1;
};

// Validation middleware
const validateItem = (req, res, next) => {
  const { name } = req.body;
  
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    const error = new Error('Name is required and must be a non-empty string');
    error.status = 400;
    return next(error);
  }
  
  next();
};

/**
 * GET /api/items
 * Returns list of all items
 */
router.get('/', (req, res, next) => {
  try {
    res.status(200).json({
      success: true,
      data: items,
      count: items.length
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/items/:id
 * Returns a single item by ID
 */
router.get('/:id', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    
    if (isNaN(id)) {
      const error = new Error('Invalid ID format');
      error.status = 400;
      throw error;
    }
    
    const item = items.find(i => i.id === id);
    
    if (!item) {
      const error = new Error(`Item with id ${id} not found`);
      error.status = 404;
      throw error;
    }
    
    res.status(200).json({
      success: true,
      data: item
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/items
 * Creates a new item
 */
router.post('/', validateItem, (req, res, next) => {
  try {
    const { name, description } = req.body;
    
    const newItem = {
      id: getNextId(),
      name: name.trim(),
      description: description || ''
    };
    
    items.push(newItem);
    
    res.status(201).json({
      success: true,
      data: newItem,
      message: 'Item created successfully'
    });
  } catch (err) {
    next(err);
  }
});

// Export router and items for testing
module.exports = router;
module.exports._items = items; // Exposed for test reset
