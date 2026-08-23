'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { assertStagingWriteTarget } = require('../config/environmentSafety');

module.exports = { assertStagingWriteTarget };
