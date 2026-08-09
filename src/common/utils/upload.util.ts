import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { extname } from 'path';
import { diskStorage } from 'multer';

// Local disk storage for now, not a cloud bucket (S3/GCS/etc.) — a
// deliberate, disclosed simplification. Known limitation worth stating
// plainly: this does NOT work correctly across multiple app instances
// (each has its own separate disk, so an image uploaded to instance A
// wouldn't be visible from instance B) and uploaded files are not
// guaranteed to survive a redeploy on most hosting platforms. Fine for a
// single-instance dev/learning setup; a real production deployment would
// swap this for S3-compatible object storage without changing the
// controller's API shape (still POST a file, still get back a URL).

export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function imageDiskStorage(subfolder: string) {
  const destination = `./uploads/${subfolder}`;
  // multer's diskStorage does NOT create missing directories itself — it
  // throws ENOENT otherwise. Ensured once here rather than requiring a
  // manual mkdir as a deploy step.
  if (!existsSync(destination)) {
    mkdirSync(destination, { recursive: true });
  }

  return diskStorage({
    destination,
    filename: (_req, file, callback) => {
      // Random filename, not the client-supplied one — never trust a
      // client-provided filename directly (path traversal / collision risk).
      callback(null, `${randomUUID()}${extname(file.originalname)}`);
    },
  });
}

export function imageFileFilter(
  _req: unknown,
  file: { mimetype: string },
  callback: (error: Error | null, acceptFile: boolean) => void,
): void {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    callback(new BadRequestException('Only JPEG, PNG, or WebP images are allowed'), false);
    return;
  }
  callback(null, true);
}
