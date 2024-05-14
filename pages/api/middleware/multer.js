import multer from "multer";

const upload = multer({ storage: multer.memoryStorage() });

// Middleware to handle 'multipart/form-data'
export const multerUploads = upload.fields([
  { name: "previous" },
  { name: "new" },
]);

export function applyMulterMiddleware(req, res, fn) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result) => {
      if (result instanceof Error) {
        return reject(result);
      }
      return resolve(result);
    });
  });
}
