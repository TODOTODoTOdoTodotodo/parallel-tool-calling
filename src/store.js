const { EventEmitter } = require("events");

const STATUS = {
  PENDING: "pending",
  READY: "ready",
  FAILED: "failed",
  EXPIRED: "expired"
};

class SearchStore extends EventEmitter {
  constructor() {
    super();
    this.requests = new Map();
  }

  createRequest({ requestId, userId, query, ttlMs }) {
    const now = Date.now();
    const record = {
      requestId,
      userId,
      query,
      status: STATUS.PENDING,
      createdAt: now,
      expiresAt: now + ttlMs,
      results: {
        normal: null,
        mcp: null
      }
    };
    this.requests.set(requestId, record);
    return record;
  }

  getRequest(requestId) {
    return this.requests.get(requestId) || null;
  }

  getRequestForUser(requestId, userId) {
    const record = this.getRequest(requestId);
    if (!record) return null;
    if (record.userId !== userId) return "forbidden";
    if (this.isExpired(record)) {
      record.status = STATUS.EXPIRED;
    }
    return record;
  }

  setNormalResults(requestId, results) {
    const record = this.getRequest(requestId);
    if (!record) return;
    record.results.normal = results;
  }

  setMcpResults(requestId, results) {
    const record = this.getRequest(requestId);
    if (!record) return;
    record.results.mcp = results;
    record.status = STATUS.READY;
    this.emit("mcp-ready", { requestId });
  }

  setFailed(requestId) {
    const record = this.getRequest(requestId);
    if (!record) return;
    if (this.isExpired(record)) {
      record.status = STATUS.EXPIRED;
      return;
    }
    record.status = STATUS.FAILED;
  }

  isExpired(record) {
    return Date.now() > record.expiresAt;
  }

  deleteRequest(requestId) {
    this.requests.delete(requestId);
  }

  clear() {
    this.requests.clear();
  }
}

module.exports = {
  SearchStore,
  STATUS
};
