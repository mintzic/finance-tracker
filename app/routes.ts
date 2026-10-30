import { type RouteConfig, index, route } from '@react-router/dev/routes';
export default [index('routes/home.tsx'),route('receipts/:id','routes/receipt.ts'),route('export','routes/export.ts')] satisfies RouteConfig;
