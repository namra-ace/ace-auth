import { Request, Response, NextFunction } from 'express';
import { AceAuth } from '../core/AceAuth';

export function gatekeeper(auth: AceAuth) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({ error: 'Authorization header missing' });
      }

      // Expected format: "Bearer <token>"
      const [scheme, token] = authHeader.split(' ');
      if (scheme !== 'Bearer' || !token) {
        return res.status(401).json({ error: 'Invalid authorization format' });
      }

      // 1. Authorize (L1 + L2 cache, rotation handled internally)
      const result = await auth.authorize(token);

      if (!result.valid) {
        return res.status(401).json({ error: 'Invalid or expired session' });
      }

      // 2. Attach Auth Context
      (req as any).user = result.user;
      (req as any).sessionId = result.sessionId;

      // 3. Transparent Token Rotation
      // If a new token is issued, it is returned via response header.
      // Clients should replace their stored token when this header is present.
      if (result.token) {
        res.setHeader('X-Ace-Token', result.token);
        res.setHeader('Access-Control-Expose-Headers', 'X-Ace-Token');
      }

      next();
    } catch {
      // Intentionally silent for performance + security
      res.status(500).json({ error: 'Authentication failed' });
    }
  };
}
