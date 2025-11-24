"use client";

import { FormEvent, useMemo, useState } from "react";
import styles from "./page.module.css";

type Status = "idle" | "loading" | "success" | "error";

interface FetchState<T> {
  status: Status;
  data?: T;
  message?: string;
}

type ProcessResponse = {
  status: string;
  upc?: string;
  message?: string;
  total?: number;
  queued?: number;
  already_processing?: number;
};

type ProductResponse = {
  upc: string;
  title?: string;
  brand?: string;
  description?: string;
  model?: string;
  color?: string;
  size?: string;
  dimension?: string;
  weight?: string;
  category?: string;
  currency?: string;
  lowest_recorded_price?: number;
  highest_recorded_price?: number;
  msrp?: number;
  images?: string[];
  best_image?: string;
  cached?: boolean;
  source?: string;
};

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5000";

const formatJson = (value: unknown) => JSON.stringify(value, null, 2);

export default function Home() {
  const [singleUpc, setSingleUpc] = useState("");
  const [searchUpc, setSearchUpc] = useState("");
  const [csvFile, setCsvFile] = useState<File | null>(null);

  const [singleStatus, setSingleStatus] = useState<FetchState<ProcessResponse>>({
    status: "idle",
  });
  const [batchStatus, setBatchStatus] = useState<FetchState<ProcessResponse>>({
    status: "idle",
  });
  const [searchStatus, setSearchStatus] =
    useState<FetchState<ProductResponse>>({
      status: "idle",
    });

  const disableSingleSubmit = !singleUpc || singleStatus.status === "loading";
  const disableBatchSubmit = !csvFile || batchStatus.status === "loading";
  const disableSearchSubmit = !searchUpc || searchStatus.status === "loading";

  const apiInfo = useMemo(
    () => ({
      baseUrl: API_BASE_URL,
      hasCustomBase:
        process.env.NEXT_PUBLIC_API_BASE_URL !== undefined &&
        process.env.NEXT_PUBLIC_API_BASE_URL !== "",
    }),
    []
  );

  const handleProcessSingle = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSingleStatus({ status: "loading" });
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/process/${singleUpc}`,
        { method: "POST" }
      );
      const payload = await response.json();
      if (!response.ok) {
        setSingleStatus({
          status: "error",
          message: payload?.message ?? "Failed to queue UPC.",
        });
        return;
      }
      setSingleStatus({
        status: "success",
        data: payload,
        message: "UPC sent for background processing.",
      });
      setSingleUpc("");
    } catch (error) {
      setSingleStatus({
        status: "error",
        message:
          error instanceof Error ? error.message : "Unable to reach the API.",
      });
    }
  };

  const handleBatchUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!csvFile) {
      setBatchStatus({
        status: "error",
        message: "Please attach a CSV file before submitting.",
      });
      return;
    }
    setBatchStatus({ status: "loading" });
    try {
      const formData = new FormData();
      formData.append("file", csvFile);
      const response = await fetch(`${API_BASE_URL}/api/process/batch`, {
        method: "POST",
        body: formData,
      });
      const payload = await response.json();
      if (!response.ok) {
        setBatchStatus({
          status: "error",
          message: payload?.message ?? "Failed to process CSV.",
        });
        return;
      }
      setBatchStatus({
        status: "success",
        data: payload,
        message: "Batch uploaded successfully.",
      });
      setCsvFile(null);
      // Reset file input safely
      const fileInput = event.currentTarget?.querySelector('input[type="file"]') as HTMLInputElement | null;
      if (fileInput) {
        fileInput.value = "";
      }
    } catch (error) {
      setBatchStatus({
        status: "error",
        message:
          error instanceof Error ? error.message : "Unable to reach the API.",
      });
    }
  };

  const handleSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSearchStatus({ status: "loading" });
    try {
      const response = await fetch(`${API_BASE_URL}/api/product/${searchUpc}`);
      if (response.status === 404) {
        setSearchStatus({
          status: "error",
          message: "No product found for that UPC.",
        });
        return;
      }
      const payload = await response.json();
      if (!response.ok) {
        setSearchStatus({
          status: "error",
          message: payload?.message ?? "Failed to load product.",
        });
        return;
      }
      setSearchStatus({
        status: "success",
        data: payload,
        message: "Product loaded.",
      });
    } catch (error) {
      setSearchStatus({
        status: "error",
        message:
          error instanceof Error ? error.message : "Unable to reach the API.",
      });
    }
  };

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <p className={styles.overline}>UPC Product Lookup</p>
            <h1>Manage and search UPC jobs from the browser</h1>
            <p className={styles.subtitle}>
              Quickly send new UPCs for processing, upload CSV batches, and
              fetch cached product data from the Flask service.
            </p>
          </div>
          <div className={styles.apiBadge}>
            <span>API:</span>
            <strong>
              {apiInfo.hasCustomBase ? apiInfo.baseUrl : "http://localhost:5000"}
            </strong>
          </div>
        </header>

        <section className={styles.cards}>
          <article className={styles.card}>
            <h2>Queue a single UPC</h2>
            <p>Send one UPC code to the `/api/process/upc` endpoint.</p>
            <form onSubmit={handleProcessSingle} className={styles.form}>
              <label>
                UPC code
                <input
                  type="text"
                  inputMode="numeric"
                  value={singleUpc}
                  onChange={(event) => setSingleUpc(event.target.value.trim())}
                  placeholder="e.g. 012993441012"
                  required
                />
              </label>
              <button type="submit" disabled={disableSingleSubmit}>
                {singleStatus.status === "loading" ? "Submitting..." : "Process"}
              </button>
            </form>
            <StatusPanel
              title="Latest response"
              state={singleStatus.status}
              message={singleStatus.message}
              data={singleStatus.data}
            />
          </article>

          <article className={styles.card}>
            <h2>Upload CSV batch</h2>
            <p>Send a CSV containing a single `upc` header.</p>
            <form onSubmit={handleBatchUpload} className={styles.form}>
              <label className={styles.fileInput}>
                Select CSV file
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) =>
                    setCsvFile(event.target.files?.[0] ?? null)
                  }
                  required
                />
              </label>
              <button type="submit" disabled={disableBatchSubmit}>
                {batchStatus.status === "loading"
                  ? "Uploading..."
                  : "Upload CSV"}
              </button>
            </form>
            <StatusPanel
              title="Latest response"
              state={batchStatus.status}
              message={batchStatus.message}
              data={batchStatus.data}
            />
          </article>

          <article className={styles.card}>
            <h2>Search cached product</h2>
            <p>Query the `/api/upc/:code` endpoint for stored details.</p>
            <form onSubmit={handleSearch} className={styles.form}>
              <label>
                UPC code
                <input
                  type="text"
                  inputMode="numeric"
                  value={searchUpc}
                  onChange={(event) => setSearchUpc(event.target.value.trim())}
                  placeholder="e.g. 012993441012"
                  required
                />
              </label>
              <button type="submit" disabled={disableSearchSubmit}>
                {searchStatus.status === "loading" ? "Searching..." : "Search"}
              </button>
            </form>
            {searchStatus.status === "success" && searchStatus.data ? (
              <div className={styles.product}>
                <div>
                  <p className={styles.productLabel}>Product</p>
                  <h3>{searchStatus.data.title ?? "Untitled"}</h3>
                  
                  {/* Basic Info */}
                  <p className={styles.productMeta}>
                    UPC: {searchStatus.data.upc}
                    {searchStatus.data.brand && ` · Brand: ${searchStatus.data.brand}`}
                    {searchStatus.data.model && ` · Model: ${searchStatus.data.model}`}
                  </p>

                  {/* Pricing Information */}
                  {searchStatus.data.msrp && (
                    <div className={styles.productMeta}>
                      <strong>MSRP:</strong> {searchStatus.data.currency || "$"}{searchStatus.data.msrp.toFixed(2)}
                      {searchStatus.data.lowest_recorded_price && searchStatus.data.highest_recorded_price && (
                        <span> (Price Range: {searchStatus.data.currency || "$"}{searchStatus.data.lowest_recorded_price.toFixed(2)} - {searchStatus.data.currency || "$"}{searchStatus.data.highest_recorded_price.toFixed(2)})</span>
                      )}
                    </div>
                  )}

                  {/* Product Attributes */}
                  {(searchStatus.data.color || searchStatus.data.size || searchStatus.data.weight || searchStatus.data.dimension) && (
                    <div className={styles.productMeta}>
                      {searchStatus.data.color && <span><strong>Color:</strong> {searchStatus.data.color}</span>}
                      {searchStatus.data.color && (searchStatus.data.size || searchStatus.data.weight || searchStatus.data.dimension) && " · "}
                      {searchStatus.data.size && <span><strong>Size:</strong> {searchStatus.data.size}</span>}
                      {searchStatus.data.size && (searchStatus.data.weight || searchStatus.data.dimension) && " · "}
                      {searchStatus.data.weight && <span><strong>Weight:</strong> {searchStatus.data.weight}</span>}
                      {searchStatus.data.weight && searchStatus.data.dimension && " · "}
                      {searchStatus.data.dimension && <span><strong>Dimensions:</strong> {searchStatus.data.dimension}</span>}
                    </div>
                  )}

                  {/* Category */}
                  {searchStatus.data.category && (
                    <p className={styles.productMeta}>
                      <strong>Category:</strong> {searchStatus.data.category}
                    </p>
                  )}

                  {/* Description */}
                  {searchStatus.data.description && (
                    <p className={styles.productMeta}>
                      <strong>Description:</strong> {searchStatus.data.description}
                    </p>
                  )}

                  {/* Additional Images Count */}
                  {searchStatus.data.images && searchStatus.data.images.length > 0 && (
                    <p className={styles.productMeta}>
                      <strong>Images:</strong> {searchStatus.data.images.length} available
                      {searchStatus.data.best_image && " (Best image selected)"}
                    </p>
                  )}

                  {/* Cache Status */}
                  {searchStatus.data.cached !== undefined && (
                    <p className={styles.productMeta}>
                      <strong>Source:</strong> {searchStatus.data.cached ? "Cached" : "Fresh"}
                    </p>
                  )}
                </div>
                {searchStatus.data.best_image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={searchStatus.data.best_image}
                    alt={searchStatus.data.title ?? "Product image"}
                  />
                )}
              </div>
            ) : null}
            <StatusPanel
              title="Raw response"
              state={searchStatus.status}
              message={searchStatus.message}
              data={searchStatus.data}
            />
          </article>
        </section>
      </main>
    </div>
  );
}

type StatusPanelProps = {
  title: string;
  state: Status;
  message?: string;
  data?: unknown;
};

function StatusPanel({ title, state, message, data }: StatusPanelProps) {
  if (state === "idle") {
    return null;
  }

  return (
    <div className={styles.statusPanel} data-state={state}>
      <div className={styles.statusHeader}>
        <p>{title}</p>
        <span>{state}</span>
      </div>
      {message ? <p className={styles.statusMsg}>{message}</p> : null}
      {data ? (
        <pre className={styles.code}>{formatJson(data)}</pre>
      ) : null}
    </div>
  );
}
