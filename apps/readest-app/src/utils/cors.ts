import Cors from 'cors';
import type { NextApiRequest, NextApiResponse } from 'next';

// Helper method to wait for a middleware to execute before continuing
// And to throw an error when an error happens in a middleware
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export const runMiddleware = (req: NextApiRequest, res: NextApiResponse, fn: Function) => {
  return new Promise((resolve, reject) => {
    fn(req, res, (result: unknown) => {
      if (result instanceof Error) {
        return reject(result);
      }

      return resolve(result);
    });
  });
};

export const corsAllMethods = Cors({
  methods: ['POST', 'GET', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'],
});
