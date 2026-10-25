import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    // Next rewrites this file on every dev start unless the flag is off.
    agentRules: false,
    // The board is opened on 127.0.0.1 as well as localhost during local checks.
    allowedDevOrigins: ['127.0.0.1'],
    // Nodemailer is loaded by the monitor on the server. Leave it out of the bundle.
    serverExternalPackages: ['nodemailer'],
};

export default nextConfig;
