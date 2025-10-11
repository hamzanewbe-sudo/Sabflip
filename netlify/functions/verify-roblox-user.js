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
        const verificationCode = data.code;

        if (!robloxUsername || !verificationCode) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing username or verification code.' }) };
        }

        // --- Step 1: Get Roblox User ID (Necessary for reading profile) ---
        const userLookup = await axios.post('https://users.roblox.com/v1/usernames/users', { usernames: [robloxUsername] });
        if (userLookup.data.data.length === 0) {
            return { statusCode: 404, body: JSON.stringify({ error: 'Roblox user not found.' }) };
        }
        const robloxUserId = userLookup.data.data[0].id;

        // --- Step 2: Read Roblox Profile Description ---
        const profileResponse = await axios.get(`https://users.roblox.com/v1/users/${robloxUserId}`);
        const description = profileResponse.data.description || "";

        // --- Step 3: Check for Code in Description ---
        if (description.includes(verificationCode)) {
            // Success! In a real app, you would securely update the database/claims here.
            return {
                statusCode: 200,
                body: JSON.stringify({
                    success: true,
                    message: "Verification successful! You are now logged in."
                })
            };
        } else {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    success: false,
                    error: 'Code not found in Roblox profile description.'
                })
            };
        }
    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: 'Internal server error during verification.' }) };
    }
};
