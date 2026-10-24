import type { RequestHandler } from "express";
import { AppError } from "../errors.js";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isLocalOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      LOOPBACK_HOSTS.has(url.hostname)
    );
  } catch {
    return false;
  }
}

export function isLoopbackAddress(address: string | undefined): boolean {
  return address !== undefined && LOOPBACK_ADDRESSES.has(address);
}

export const requireLoopbackRequest: RequestHandler = (request, _response, next) => {
  const remoteAddress = request.socket.remoteAddress;
  if (!isLoopbackAddress(remoteAddress)) {
    next(
      new AppError(
        403,
        "LOCAL_ACCESS_REQUIRED",
        "老師入口僅允許從本機存取。",
      ),
    );
    return;
  }
  next();
};

export const protectLocalMutation: RequestHandler = (request, _response, next) => {
  if (SAFE_METHODS.has(request.method)) {
    next();
    return;
  }

  if (request.get("sec-fetch-site") === "cross-site") {
    next(new AppError(403, "CSRF_REJECTED", "系統拒絕跨網站的老師操作。"));
    return;
  }

  const origin = request.get("origin");
  if (origin && !isLocalOrigin(origin)) {
    next(new AppError(403, "CSRF_REJECTED", "系統拒絕非本機來源的老師操作。"));
    return;
  }

  next();
};
