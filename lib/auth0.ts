import { Auth0Client } from '@auth0/nextjs-auth0/server';

const AUTH0_AUDIENCE = process.env.NEXT_PUBLIC_AUTH0_AUDIENCE;

export const auth0 = new Auth0Client({
    authorizationParameters: {
        audience: AUTH0_AUDIENCE,
    }
});