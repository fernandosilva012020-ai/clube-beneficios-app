import { createHandlers, createServices, readConfig } from '../_shared/asaas.mjs';
const config = readConfig((name: string) => Deno.env.get(name));
Deno.serve(createHandlers(createServices(config)).createPix);
