import { Auth0Client } from '@auth0/nextjs-auth0/server';

const AUTH0_AUDIENCE = process.env.NEXT_PUBLIC_AUTH0_AUDIENCE;
const AUTH0_SCOPE = process.env.NEXT_PUBLIC_AUTH0_SCOPE;

export const auth0 = new Auth0Client({
    authorizationParameters: {
        audience: AUTH0_AUDIENCE,
        scope: AUTH0_SCOPE,
    }
});