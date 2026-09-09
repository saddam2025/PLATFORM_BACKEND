const express = require('express');
const { listFeaturedCourses, listFeaturedLectures } = require('../controllers/publicContentController');

const router = express.Router();

// No authentication or tenantScope: these endpoints power the public,
// cross-instructor discovery feed on the root landing page.
router.get('/featured-courses', listFeaturedCourses);
router.get('/featured-lectures', listFeaturedLectures);

module.exports = router;
