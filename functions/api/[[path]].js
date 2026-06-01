import app from '../../server/app.js';

export const onRequest = (context) =>
    app.fetch(context.request, context.env, context);
