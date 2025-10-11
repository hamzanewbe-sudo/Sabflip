const axios = require('axios');
// NOTE: This function currently only returns placeholder data, but it connects 
// to Firebase auth (handled by the environment) and ensures the user exists.

exports.handler = async (event, context) => {
    // Check if the user is authenticated via Firebase (provided by Netlify context)
    if (!context.clientContext || !context.clientContext.user) {
        return {
            statusCode: 401,
            body: JSON.stringify({ error: "Authentication required." })
        };
    }

    // Placeholder logic: Always requires verification initially, until verified.
    // In a real app, you would check a database here.
    const robloxVerified = false; // Assume user is not verified yet

    if (!robloxVerified) {
        // This tells the frontend to show the verification modal immediately.
        return {
            statusCode: 403,
            body: JSON.stringify({ requiresVerification: true })
        };
    }

    // Mock successful verified user data structure:
    const mockUserData = {
        userId: context.clientContext.user.sub,
        username: "VerifiedUser123",
        balance: 1000,
        pfpUrl: "https://t2.rbxcdn.com/f9c8d5f4c4a4e1a0b3a7a9e0f6b4b4d1" // Example Roblox headshot URL
    };

    return {
        statusCode: 200,
        body: JSON.stringify(mockUserData)
    };
};
