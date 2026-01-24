const Document = require('../models/Documents');

// @desc    Get all documents for logged in user
// @route   GET /api/documents?page=1&limit=20
// @access  Private
exports.getDocuments = async (req, res) => {
  try {
    // Pagination
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
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
    console.error(error);
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
    // Add user to req.body
    req.body.user = req.user.id;

    const document = await Document.create(req.body);

    res.status(201).json({
      success: true,
      message: 'Document added successfully',
      document
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error. Please try again.',
      error: error.message
    });
  }
};

// @desc    Update document
// @route   PUT /api/documents/:id
// @access  Private
exports.updateDocument = async (req, res) => {
  try {
    let document = await Document.findById(req.params.id);

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }

    // Make sure user owns document
    if (document.user.toString() !== req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized to update this document'
      });
    }

    document = await Document.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    });

    res.status(200).json({
      success: true,
      message: 'Document updated successfully',
      document
    });
  } catch (error) {
    console.error(error);
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
      return res.status(401).json({
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
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error. Please try again.'
    });
  }
};