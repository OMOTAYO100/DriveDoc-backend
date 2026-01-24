const express = require('express');
const {
  getDocuments,
  addDocument,
  updateDocument,
  deleteDocument
} = require('../controllers/documentsControllers');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Protect all routes
router.use(protect);

router.route('/')
  .get(getDocuments)
  .post(addDocument);

router.route('/:id')
  .put(updateDocument)
  .delete(deleteDocument);

module.exports = router;