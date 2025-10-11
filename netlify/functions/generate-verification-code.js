const crypto = require('crypto');
const axios = require('axios');

exports.handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    // Authentication check (ensures Firebase user token is present)
    if (!context.clientContext || !context.clientContext.user) {
        return { statusCode: 401, body: JSON.stringify({ error: "Authentication required." }) };
    }

    try {
        // CRITICAL FIX: Parse the request body from JSON
        const data = JSON.parse(event.body);
        const robloxUsername = data.robloxUsername;

        if (!robloxUsername) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Roblox username is required.' }) };
        }

        // 1. Generate a unique, 6-character code
        const verificationCode = crypto.randomBytes(3).toString('hex').toUpperCase();

        // NOTE: In a real environment, you would save {FirebaseUserID: verificationCode}
        // to your database here, associated with the Roblox Username.

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                code: verificationCode,
                message: "Code generated."
            })
        };
    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: 'Failed to generate code.' }) };
    }
};
