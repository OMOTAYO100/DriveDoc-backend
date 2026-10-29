const Document = require('../models/Documents');

// The only fields a client is allowed to set. Everything else on the schema —
// `user`, `status`, `notifications`, `createdAt` — is ours to manage. Without
// this whitelist a client could reassign `user` and plant the document in
// someone else's account, or pre-set notifications.expiredSent to silence its
// own reminders.
const WRITABLE_FIELDS = ['country', 'type', 'number', 'issueDate', 'expiryDate'];

const pickWritable = (body = {}) => {
  const out = {};
  for (const field of WRITABLE_FIELDS) {
    if (body[field] !== undefined) out[field] = body[field];
  }
  return out;
};

// @desc    Get all documents for logged in user
// @route   GET /api/documents?page=1&limit=20
// @access  Private
exports.getDocuments = async (req, res) => {
  try {
    // Pagination
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    // Get total count for pagination metadata
    const total = await Document.countDocuments({ user: req.user.id });

    const documents = await Document.find({ user: req.user.id })
      .sort('-createdAt')
      .skip(skip)
      .limit(limit);

    res.status(200).json({
      success: true,
      count: documents.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      documents
    });
  } catch (error) {
    console.error('getDocuments error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error. Please try again.'
    });
  }
};

// @desc    Add new document
// @route   POST /api/documents
// @access  Private
exports.addDocument = async (req, res) => {
  try {
    const document = await Document.create({
      ...pickWritable(req.body),
      user: req.user.id
    });

    res.status(201).json({
      success: true,
      message: 'Document added successfully',
      document
    });
  } catch (error) {
    console.error('addDocument error:', error);
    if (error.name === 'ValidationError') {
      const first = Object.values(error.errors)[0];
      return res.status(400).json({ success: false, message: first.message });
    }
    res.status(500).json({
      success: false,
      message: 'Server error. Please try again.'
    });
  }
};

// @desc    Update document
// @route   PUT /api/documents/:id
// @access  Private
exports.updateDocument = async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }

    // Make sure user owns document
    if (document.user.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this document'
      });
    }

    Object.assign(document, pickWritable(req.body));
    await document.save();

    res.status(200).json({
      success: true,
      message: 'Document updated successfully',
      document
    });
  } catch (error) {
    console.error('updateDocument error:', error);
    if (error.name === 'ValidationError') {
      const first = Object.values(error.errors)[0];
      return res.status(400).json({ success: false, message: first.message });
    }
    res.status(500).json({
      success: false,
      message: 'Server error. Please try again.'
    });
  }
};

// @desc    Delete document
// @route   DELETE /api/documents/:id
// @access  Private
exports.deleteDocument = async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }

    // Make sure user owns document
    if (document.user.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this document'
      });
    }

    await document.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Document deleted successfully'
    });
  } catch (error) {
    console.error('deleteDocument error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error. Please try again.'
    });
  }
};
