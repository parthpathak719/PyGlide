const pendingRequests = new Map();

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('message', event => {
    // No registry: a suspended service worker can recover the window identity.
    if (event.data?.type === 'input_client_id') {
        event.ports[0]?.postMessage({ clientId: event.source?.id || '' });
    } else if (event.data?.type === 'cancel_inputs') {
        for (const [uid, pending] of pendingRequests) {
            if (pending.clientId === event.source?.id && pending.ownerId === event.data.ownerId) {
                pending.resolve(new Response('Execution stopped.', { status: 410 }));
                pendingRequests.delete(uid);
            }
        }
    }
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    
    // WebWorker requests input synchronously
    if (url.pathname === '/__pyglide_input__') {
        event.respondWith((async () => {
            const uid = url.searchParams.get('uid');
            const clientId = url.searchParams.get('client_id');
            const ownerId = url.searchParams.get('owner');
            if (!uid || !clientId || !ownerId || pendingRequests.has(uid)) {
                return new Response('Invalid input request.', { status: 400 });
            }
            const client = await self.clients.get(clientId);
            if (!client || client.type !== 'window') {
                return new Response('The editor tab is no longer available.', { status: 410 });
            }
            return new Promise(resolve => {
                pendingRequests.set(uid, { resolve, clientId, ownerId });
                client.postMessage({ type: 'input_requested', uid, ownerId });
            });
        })());
    } 
    // Main thread provides the input asynchronously
    else if (url.pathname === '/__pyglide_provide_input__') {
        event.respondWith((async () => {
            const formData = await event.request.formData();
            const uid = formData.get('uid');
            const pending = pendingRequests.get(uid);
            if (!pending || pending.clientId !== event.clientId || pending.ownerId !== formData.get('owner')) {
                return new Response('Input request expired or belongs to another tab.', { status: 409 });
            }
            pending.resolve(new Response(formData.get('value') || '', { status: 200 }));
            pendingRequests.delete(uid);
            return new Response('ok', { status: 200 });
        })());
    }
});
