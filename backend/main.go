package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	_ "modernc.org/sqlite"
)

var (
	jwtSecret = []byte(getEnv("JWT_SECRET", "aurora-super-secret-key-change-in-prod-32bytes"))
)

type Config struct {
	Port            int
	InstanceID      string
	DBPath          string
	DiscountPercent int
}

type Server struct {
	cfg Config
	db  *sql.DB
}

// ----------------------------------------------------------------------------
// Database Models & Requests
// ----------------------------------------------------------------------------

type User struct {
	ID        int64     `json:"id"`
	Username  string    `json:"username"`
	Role      string    `json:"role"`
	CreatedAt time.Time `json:"created_at"`
}

type Product struct {
	ID          int64     `json:"id"`
	SKU         string    `json:"sku"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Category    string    `json:"category"`
	PriceCents  int64     `json:"price_cents"`
	PriceUSD    float64   `json:"price_usd"`
	Stock       int       `json:"stock"`
	CreatedAt   time.Time `json:"created_at"`
}

type OrderItemReq struct {
	ProductID int64 `json:"product_id"`
	Quantity  int   `json:"quantity"`
}

type CreateOrderReq struct {
	UserID int64          `json:"user_id"`
	Items  []OrderItemReq `json:"items"`
}

type OrderItemResp struct {
	ID             int64   `json:"id"`
	ProductID      int64   `json:"product_id"`
	ProductName    string  `json:"product_name"`
	SKU            string  `json:"sku"`
	Quantity       int     `json:"quantity"`
	UnitPriceCents int64   `json:"unit_price_cents"`
	TotalPriceUSD  float64 `json:"total_price_usd"`
}

type OrderResp struct {
	ID             int64           `json:"id"`
	UserID         int64           `json:"user_id"`
	TotalCents     int64           `json:"total_cents"`
	DiscountCents  int64           `json:"discount_cents"`
	FinalCents     int64           `json:"final_cents"`
	FinalUSD       float64         `json:"final_usd"`
	Status         string          `json:"status"`
	InstanceID     string          `json:"instance_id"`
	DiscountNotice string          `json:"discount_notice,omitempty"`
	CreatedAt      time.Time       `json:"created_at"`
	Items          []OrderItemResp `json:"items"`
}

// ----------------------------------------------------------------------------
// Database Setup & Seeding
// ----------------------------------------------------------------------------

func initDB(dbPath string) (*sql.DB, error) {
	if dir := filepath.Dir(dbPath); dir != "." && dir != "" {
		_ = os.MkdirAll(dir, 0755)
	}

	dsn := fmt.Sprintf("%s?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=foreign_keys(ON)", dbPath)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	db.SetMaxOpenConns(64)
	db.SetMaxIdleConns(16)
	db.SetConnMaxLifetime(time.Hour)

	schema := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT UNIQUE NOT NULL COLLATE NOCASE,
		password_hash TEXT NOT NULL,
		role TEXT NOT NULL DEFAULT 'customer',
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS products (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		sku TEXT UNIQUE NOT NULL,
		name TEXT NOT NULL,
		description TEXT NOT NULL,
		category TEXT NOT NULL,
		price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
		stock INTEGER NOT NULL CHECK(stock >= 0),
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_products_cat ON products(category);
	CREATE INDEX IF NOT EXISTS idx_products_price ON products(price_cents);
	CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);

	CREATE TABLE IF NOT EXISTS orders (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL REFERENCES users(id),
		total_cents INTEGER NOT NULL,
		discount_cents INTEGER NOT NULL DEFAULT 0,
		final_cents INTEGER NOT NULL,
		status TEXT NOT NULL DEFAULT 'completed',
		instance_id TEXT NOT NULL,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);

	CREATE TABLE IF NOT EXISTS order_items (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
		product_id INTEGER NOT NULL REFERENCES products(id),
		quantity INTEGER NOT NULL CHECK(quantity > 0),
		unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents >= 0)
	);

	CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
	`

	if _, err := db.Exec(schema); err != nil {
		return nil, fmt.Errorf("exec schema: %w", err)
	}

	return db, nil
}

func seedDatabase(db *sql.DB) error {
	var userCount int
	if err := db.QueryRow("SELECT COUNT(*) FROM users").Scan(&userCount); err != nil {
		return err
	}
	if userCount == 0 {
		log.Println("==> Seeding users (admin, customer)...")
		hashAdmin, _ := bcrypt.GenerateFromPassword([]byte("admin123"), bcrypt.DefaultCost)
		hashUser, _ := bcrypt.GenerateFromPassword([]byte("password123"), bcrypt.DefaultCost)

		_, err := db.Exec(`
			INSERT INTO users (username, password_hash, role) VALUES 
			('admin', ?, 'admin'),
			('alice', ?, 'customer'),
			('bob', ?, 'customer')
		`, string(hashAdmin), string(hashUser), string(hashUser))
		if err != nil {
			return fmt.Errorf("seed users: %w", err)
		}
	}

	var productCount int
	if err := db.QueryRow("SELECT COUNT(*) FROM products").Scan(&productCount); err != nil {
		return err
	}
	if productCount < 10000 {
		log.Printf("==> Current products: %d. Seeding up to 10,000 real catalog products...", productCount)
		categories := []string{
			"Electronics", "Computers", "Smartphones", "Audio",
			"Home & Kitchen", "Office", "Wearables", "Gaming",
			"Networking", "Security",
		}
		adjectives := []string{
			"Pro", "Ultra", "Max", "Elite", "Prime", "Compact", "Wireless",
			"Smart", "Enterprise", "Quantum", "Hyper", "Turbo",
		}
		nouns := []string{
			"Laptop", "Router", "Switch", "Headphones", "Camera", "Sensor",
			"Display", "Adapter", "Keyboard", "Gateway", "Speaker", "Charger",
		}

		tx, err := db.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()

		stmt, err := tx.Prepare(`
			INSERT OR IGNORE INTO products (sku, name, description, category, price_cents, stock)
			VALUES (?, ?, ?, ?, ?, ?)
		`)
		if err != nil {
			return err
		}
		defer stmt.Close()

		needed := 10000 - productCount
		for i := 1; i <= needed; i++ {
			sku := fmt.Sprintf("AUR-PROD-%05d", productCount+i)
			cat := categories[i%len(categories)]
			adj := adjectives[(i*7)%len(adjectives)]
			noun := nouns[(i*13)%len(nouns)]
			name := fmt.Sprintf("Aurora %s %s Gen-%d", adj, noun, (i%5)+1)
			desc := fmt.Sprintf("High-grade industrial %s for modern enterprise infrastructures. Model %s.", strings.ToLower(noun), sku)
			priceCents := int64((i*37)%50000 + 999) // $9.99 to $509.99
			stock := (i*19)%200 + 10                // 10 to 210 units

			if _, err := stmt.Exec(sku, name, desc, cat, priceCents, stock); err != nil {
				return fmt.Errorf("seed product %d: %w", i, err)
			}
		}

		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit seed: %w", err)
		}
		log.Println("==> Product catalog successfully seeded (10,000 items).")
	}

	return nil
}

// ----------------------------------------------------------------------------
// Handlers & Business Logic
// ----------------------------------------------------------------------------

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()

	// 1. Health & Readiness (Pings DB)
	mux.HandleFunc("GET /healthz", s.handleHealthz)
	mux.HandleFunc("GET /readyz", s.handleHealthz)

	// 2. Authentication API
	mux.HandleFunc("POST /api/v1/auth/register", s.handleRegister)
	mux.HandleFunc("POST /api/v1/auth/login", s.handleLogin)
	mux.HandleFunc("GET /api/v1/users/me", s.handleUsersMe)

	// 3. Products Catalog API
	mux.HandleFunc("GET /api/v1/products", s.handleListProducts)
	mux.HandleFunc("GET /api/v1/products/{id}", s.handleGetProduct)
	mux.HandleFunc("POST /api/v1/products", s.handleCreateProduct)

	// 4. ACID Order Processing API
	mux.HandleFunc("POST /api/v1/orders", s.handleCreateOrder)
	mux.HandleFunc("GET /api/v1/orders", s.handleListOrders)
	mux.HandleFunc("GET /api/v1/orders/{id}", s.handleGetOrder)

	// 5. System Analytics & Aggregations
	mux.HandleFunc("GET /api/v1/stats", s.handleStats)

	// 6. Diagnostics & Echo
	mux.HandleFunc("/api/v1/echo", s.handleEcho)

	return s.withMiddleware(mux)
}

func (s *Server) withMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		// Set upstream instance header so callers / tests know which backend served it
		w.Header().Set("X-Upstream-Instance", s.cfg.InstanceID)
		w.Header().Set("X-Upstream-Discount", fmt.Sprintf("%d%%", s.cfg.DiscountPercent))
		w.Header().Set("Server", "Aurora-Backend/1.0")

		// CORS Headers
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-User-Id, X-User-Role")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		rw := &responseWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rw, r)

		duration := time.Since(start)
		if duration > 50*time.Millisecond || rw.status >= 400 {
			log.Printf("[%s] %s %s -> %d (%s) [%s]",
				s.cfg.InstanceID, r.Method, r.URL.Path, rw.status, duration, r.RemoteAddr)
		}
	})
}

type responseWriter struct {
	http.ResponseWriter
	status int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.status = code
	rw.ResponseWriter.WriteHeader(code)
}

// ----------------------------------------------------------------------------
// Health Handler
// ----------------------------------------------------------------------------

func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	var count int
	if err := s.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM products").Scan(&count); err != nil {
		jsonError(w, "database unhealthy: "+err.Error(), http.StatusServiceUnavailable)
		return
	}
	jsonResponse(w, http.StatusOK, map[string]any{
		"status":           "ok",
		"instance_id":      s.cfg.InstanceID,
		"discount_percent": s.cfg.DiscountPercent,
		"database":         "healthy",
		"total_products":   count,
		"timestamp":        time.Now().UTC().Format(time.RFC3339Nano),
	})
}

// ----------------------------------------------------------------------------
// Auth Handlers
// ----------------------------------------------------------------------------

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Username == "" || len(req.Password) < 6 {
		jsonError(w, "Invalid input: username required and password length >= 6", http.StatusBadRequest)
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		jsonError(w, "password hashing failed", http.StatusInternalServerError)
		return
	}

	res, err := s.db.ExecContext(r.Context(),
		"INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'customer')",
		req.Username, string(hash))
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			jsonError(w, "Username already taken", http.StatusConflict)
			return
		}
		jsonError(w, "create user failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	id, _ := res.LastInsertId()
	jsonResponse(w, http.StatusCreated, map[string]any{
		"message": "User registered successfully",
		"user": map[string]any{
			"id":       id,
			"username": req.Username,
			"role":     "customer",
		},
	})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "Invalid json", http.StatusBadRequest)
		return
	}

	var user User
	var hash string
	err := s.db.QueryRowContext(r.Context(),
		"SELECT id, username, password_hash, role, created_at FROM users WHERE username = ?",
		req.Username).Scan(&user.ID, &user.Username, &hash, &user.Role, &user.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) || bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.Password)) != nil {
		jsonError(w, "Invalid username or password", http.StatusUnauthorized)
		return
	}

	claims := jwt.MapClaims{
		"sub":      strconv.FormatInt(user.ID, 10),
		"username": user.Username,
		"role":     user.Role,
		"iss":      "aurora-backend",
		"exp":      time.Now().Add(24 * time.Hour).Unix(),
		"iat":      time.Now().Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenStr, err := token.SignedString(jwtSecret)
	if err != nil {
		jsonError(w, "sign token: "+err.Error(), http.StatusInternalServerError)
		return
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"token": tokenStr,
		"user":  user,
	})
}

func (s *Server) handleUsersMe(w http.ResponseWriter, r *http.Request) {
	// First preference: Header forwarded by Gateway JWT plugin (e.g. X-User-Id)
	userIDStr := r.Header.Get("X-User-Id")

	// Fallback: Direct Authorization header
	if userIDStr == "" {
		auth := r.Header.Get("Authorization")
		if strings.HasPrefix(strings.ToLower(auth), "bearer ") {
			tokenStr := strings.TrimSpace(auth[7:])
			token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (any, error) {
				return jwtSecret, nil
			})
			if err == nil && token.Valid {
				if claims, ok := token.Claims.(jwt.MapClaims); ok {
					if sub, ok := claims["sub"].(string); ok {
						userIDStr = sub
					}
				}
			}
		}
	}

	if userIDStr == "" {
		jsonError(w, "Unauthorized: missing or invalid credentials", http.StatusUnauthorized)
		return
	}

	userID, _ := strconv.ParseInt(userIDStr, 10, 64)
	var u User
	err := s.db.QueryRowContext(r.Context(),
		"SELECT id, username, role, created_at FROM users WHERE id = ?", userID).
		Scan(&u.ID, &u.Username, &u.Role, &u.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		jsonError(w, "User not found", http.StatusNotFound)
		return
	} else if err != nil {
		jsonError(w, "db query error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	jsonResponse(w, http.StatusOK, u)
}

// ----------------------------------------------------------------------------
// Products Catalog Handlers
// ----------------------------------------------------------------------------

func (s *Server) handleListProducts(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	category := r.URL.Query().Get("category")
	minPriceStr := r.URL.Query().Get("min_price")
	maxPriceStr := r.URL.Query().Get("max_price")
	sort := r.URL.Query().Get("sort")

	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if offset < 0 {
		offset = 0
	}

	var conditions []string
	var args []any

	if q != "" {
		conditions = append(conditions, "(name LIKE ? OR sku LIKE ?)")
		pattern := "%" + q + "%"
		args = append(args, pattern, pattern)
	}
	if category != "" {
		conditions = append(conditions, "category = ?")
		args = append(args, category)
	}
	if minPriceStr != "" {
		if minPrice, err := strconv.ParseInt(minPriceStr, 10, 64); err == nil {
			conditions = append(conditions, "price_cents >= ?")
			args = append(args, minPrice)
		}
	}
	if maxPriceStr != "" {
		if maxPrice, err := strconv.ParseInt(maxPriceStr, 10, 64); err == nil {
			conditions = append(conditions, "price_cents <= ?")
			args = append(args, maxPrice)
		}
	}

	whereClause := ""
	if len(conditions) > 0 {
		whereClause = "WHERE " + strings.Join(conditions, " AND ")
	}

	orderClause := "ORDER BY id ASC"
	switch sort {
	case "price_asc":
		orderClause = "ORDER BY price_cents ASC"
	case "price_desc":
		orderClause = "ORDER BY price_cents DESC"
	case "newest":
		orderClause = "ORDER BY id DESC"
	}

	// 1. Count matching
	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM products %s", whereClause)
	var total int
	if err := s.db.QueryRowContext(r.Context(), countQuery, args...).Scan(&total); err != nil {
		jsonError(w, "count error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// 2. Fetch page
	query := fmt.Sprintf(`
		SELECT id, sku, name, description, category, price_cents, stock, created_at 
		FROM products 
		%s 
		%s 
		LIMIT ? OFFSET ?
	`, whereClause, orderClause)

	args = append(args, limit, offset)
	rows, err := s.db.QueryContext(r.Context(), query, args...)
	if err != nil {
		jsonError(w, "query error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	products := make([]Product, 0, limit)
	for rows.Next() {
		var p Product
		if err := rows.Scan(&p.ID, &p.SKU, &p.Name, &p.Description, &p.Category, &p.PriceCents, &p.Stock, &p.CreatedAt); err != nil {
			jsonError(w, "scan error: "+err.Error(), http.StatusInternalServerError)
			return
		}
		p.PriceUSD = float64(p.PriceCents) / 100.0
		products = append(products, p)
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"total":     total,
		"limit":     limit,
		"offset":    offset,
		"items":     products,
		"instance":  s.cfg.InstanceID,
		"timestamp": time.Now().UTC(),
	})
}

func (s *Server) handleGetProduct(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		jsonError(w, "Invalid product id", http.StatusBadRequest)
		return
	}

	var p Product
	err = s.db.QueryRowContext(r.Context(), `
		SELECT id, sku, name, description, category, price_cents, stock, created_at 
		FROM products WHERE id = ?
	`, id).Scan(&p.ID, &p.SKU, &p.Name, &p.Description, &p.Category, &p.PriceCents, &p.Stock, &p.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		jsonError(w, "Product not found", http.StatusNotFound)
		return
	} else if err != nil {
		jsonError(w, "query error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	p.PriceUSD = float64(p.PriceCents) / 100.0
	jsonResponse(w, http.StatusOK, p)
}

func (s *Server) handleCreateProduct(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name        string  `json:"name"`
		SKU         string  `json:"sku"`
		Description string  `json:"description"`
		Category    string  `json:"category"`
		PriceUSD    float64 `json:"price_usd"`
		Stock       int     `json:"stock"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" || req.SKU == "" {
		jsonError(w, "Invalid product data", http.StatusBadRequest)
		return
	}

	priceCents := int64(req.PriceUSD * 100.0)
	res, err := s.db.ExecContext(r.Context(), `
		INSERT INTO products (sku, name, description, category, price_cents, stock)
		VALUES (?, ?, ?, ?, ?, ?)
	`, req.SKU, req.Name, req.Description, req.Category, priceCents, req.Stock)
	if err != nil {
		jsonError(w, "insert error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	id, _ := res.LastInsertId()
	jsonResponse(w, http.StatusCreated, map[string]any{
		"message": "Product created",
		"id":      id,
	})
}

// ----------------------------------------------------------------------------
// ACID Order Processing Handlers (Multi-Row Transactions)
// ----------------------------------------------------------------------------

func (s *Server) handleCreateOrder(w http.ResponseWriter, r *http.Request) {
	var req CreateOrderReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Items) == 0 {
		jsonError(w, "Invalid order request: items required", http.StatusBadRequest)
		return
	}
	if req.UserID <= 0 {
		req.UserID = 1 // Default customer if omitted
	}

	// 1. Begin Multi-Statement ACID Transaction
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		jsonError(w, "begin tx: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	var totalCents int64
	type itemDetail struct {
		productID  int64
		sku        string
		name       string
		quantity   int
		unitPrice  int64
	}
	details := make([]itemDetail, 0, len(req.Items))

	for _, item := range req.Items {
		if item.Quantity <= 0 {
			jsonError(w, "Quantity must be positive", http.StatusBadRequest)
			return
		}

		var currentStock int
		var unitPrice int64
		var name, sku string

		// Atomic verification & inventory row lock
		err := tx.QueryRowContext(r.Context(), `
			SELECT sku, name, price_cents, stock 
			FROM products 
			WHERE id = ?
		`, item.ProductID).Scan(&sku, &name, &unitPrice, &currentStock)
		if errors.Is(err, sql.ErrNoRows) {
			jsonError(w, fmt.Sprintf("Product ID %d does not exist", item.ProductID), http.StatusBadRequest)
			return
		} else if err != nil {
			jsonError(w, "tx query error: "+err.Error(), http.StatusInternalServerError)
			return
		}

		if currentStock < item.Quantity {
			jsonError(w, fmt.Sprintf("Out of stock: product %s has %d left, requested %d",
				sku, currentStock, item.Quantity), http.StatusBadRequest)
			return
		}

		// Deduct stock in transaction
		_, err = tx.ExecContext(r.Context(), `
			UPDATE products 
			SET stock = stock - ? 
			WHERE id = ?
		`, item.Quantity, item.ProductID)
		if err != nil {
			jsonError(w, "stock update error: "+err.Error(), http.StatusInternalServerError)
			return
		}

		totalCents += unitPrice * int64(item.Quantity)
		details = append(details, itemDetail{
			productID: item.ProductID,
			sku:       sku,
			name:      name,
			quantity:  item.Quantity,
			unitPrice: unitPrice,
		})
	}

	// Calculate Canary Discount (e.g. 10% on v2)
	discountCents := int64(0)
	discountNotice := ""
	if s.cfg.DiscountPercent > 0 {
		discountCents = (totalCents * int64(s.cfg.DiscountPercent)) / 100
		discountNotice = fmt.Sprintf("Applied %d%% Canary Promotional Discount via %s",
			s.cfg.DiscountPercent, s.cfg.InstanceID)
	}
	finalCents := totalCents - discountCents

	// Insert Order Header
	res, err := tx.ExecContext(r.Context(), `
		INSERT INTO orders (user_id, total_cents, discount_cents, final_cents, status, instance_id)
		VALUES (?, ?, ?, ?, 'completed', ?)
	`, req.UserID, totalCents, discountCents, finalCents, s.cfg.InstanceID)
	if err != nil {
		jsonError(w, "insert order error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	orderID, _ := res.LastInsertId()

	// Insert Line Items
	itemStmt, err := tx.PrepareContext(r.Context(), `
		INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents)
		VALUES (?, ?, ?, ?)
	`)
	if err != nil {
		jsonError(w, "prepare item stmt: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer itemStmt.Close()

	var respItems []OrderItemResp
	for _, d := range details {
		if _, err := itemStmt.ExecContext(r.Context(), orderID, d.productID, d.quantity, d.unitPrice); err != nil {
			jsonError(w, "insert line item: "+err.Error(), http.StatusInternalServerError)
			return
		}
		respItems = append(respItems, OrderItemResp{
			ProductID:      d.productID,
			ProductName:    d.name,
			SKU:            d.sku,
			Quantity:       d.quantity,
			UnitPriceCents: d.unitPrice,
			TotalPriceUSD:  float64(d.unitPrice*int64(d.quantity)) / 100.0,
		})
	}

	// 2. Commit ACID Transaction
	if err := tx.Commit(); err != nil {
		jsonError(w, "commit order: "+err.Error(), http.StatusInternalServerError)
		return
	}

	jsonResponse(w, http.StatusCreated, OrderResp{
		ID:             orderID,
		UserID:         req.UserID,
		TotalCents:     totalCents,
		DiscountCents:  discountCents,
		FinalCents:     finalCents,
		FinalUSD:       float64(finalCents) / 100.0,
		Status:         "completed",
		InstanceID:     s.cfg.InstanceID,
		DiscountNotice: discountNotice,
		CreatedAt:      time.Now().UTC(),
		Items:          respItems,
	})
}

func (s *Server) handleListOrders(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.QueryContext(r.Context(), `
		SELECT id, user_id, total_cents, discount_cents, final_cents, status, instance_id, created_at 
		FROM orders 
		ORDER BY id DESC 
		LIMIT 50
	`)
	if err != nil {
		jsonError(w, "query orders: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var orders []OrderResp
	for rows.Next() {
		var o OrderResp
		if err := rows.Scan(&o.ID, &o.UserID, &o.TotalCents, &o.DiscountCents, &o.FinalCents, &o.Status, &o.InstanceID, &o.CreatedAt); err != nil {
			jsonError(w, "scan order: "+err.Error(), http.StatusInternalServerError)
			return
		}
		o.FinalUSD = float64(o.FinalCents) / 100.0
		orders = append(orders, o)
	}

	jsonResponse(w, http.StatusOK, map[string]any{
		"total": len(orders),
		"items": orders,
	})
}

func (s *Server) handleGetOrder(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		jsonError(w, "Invalid order id", http.StatusBadRequest)
		return
	}

	var o OrderResp
	err = s.db.QueryRowContext(r.Context(), `
		SELECT id, user_id, total_cents, discount_cents, final_cents, status, instance_id, created_at 
		FROM orders WHERE id = ?
	`, id).Scan(&o.ID, &o.UserID, &o.TotalCents, &o.DiscountCents, &o.FinalCents, &o.Status, &o.InstanceID, &o.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		jsonError(w, "Order not found", http.StatusNotFound)
		return
	} else if err != nil {
		jsonError(w, "query order: "+err.Error(), http.StatusInternalServerError)
		return
	}
	o.FinalUSD = float64(o.FinalCents) / 100.0

	// Get line items
	rows, err := s.db.QueryContext(r.Context(), `
		SELECT oi.id, oi.product_id, p.name, p.sku, oi.quantity, oi.unit_price_cents
		FROM order_items oi
		JOIN products p ON p.id = oi.product_id
		WHERE oi.order_id = ?
	`, id)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var it OrderItemResp
			if err := rows.Scan(&it.ID, &it.ProductID, &it.ProductName, &it.SKU, &it.Quantity, &it.UnitPriceCents); err == nil {
				it.TotalPriceUSD = float64(it.UnitPriceCents*int64(it.Quantity)) / 100.0
				o.Items = append(o.Items, it)
			}
		}
	}

	jsonResponse(w, http.StatusOK, o)
}

// ----------------------------------------------------------------------------
// Analytics & Stats Handlers
// ----------------------------------------------------------------------------

func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	var totalOrders int64
	var totalRevenueCents int64
	_ = s.db.QueryRowContext(r.Context(), "SELECT COUNT(*), COALESCE(SUM(final_cents), 0) FROM orders").
		Scan(&totalOrders, &totalRevenueCents)

	var totalProducts int64
	var totalStock int64
	_ = s.db.QueryRowContext(r.Context(), "SELECT COUNT(*), COALESCE(SUM(stock), 0) FROM products").
		Scan(&totalProducts, &totalStock)

	jsonResponse(w, http.StatusOK, map[string]any{
		"instance_id":         s.cfg.InstanceID,
		"discount_percent":    s.cfg.DiscountPercent,
		"total_orders":        totalOrders,
		"total_revenue_usd":   float64(totalRevenueCents) / 100.0,
		"total_catalog_items": totalProducts,
		"total_stock_units":   totalStock,
		"server_time":         time.Now().UTC(),
	})
}

func (s *Server) handleEcho(w http.ResponseWriter, r *http.Request) {
	var body any
	_ = json.NewDecoder(r.Body).Decode(&body)

	jsonResponse(w, http.StatusOK, map[string]any{
		"instance_id": s.cfg.InstanceID,
		"method":      r.Method,
		"path":        r.URL.Path,
		"query":       r.URL.Query(),
		"headers":     r.Header,
		"body":        body,
		"client_ip":   r.RemoteAddr,
	})
}

// ----------------------------------------------------------------------------
// Utilities
// ----------------------------------------------------------------------------

func jsonResponse(w http.ResponseWriter, code int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(data)
}

func jsonError(w http.ResponseWriter, msg string, code int) {
	jsonResponse(w, code, map[string]any{
		"error":  msg,
		"status": code,
	})
}

func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}

// ----------------------------------------------------------------------------
// Main Entrypoint
// ----------------------------------------------------------------------------

func main() {
	var cfg Config
	flag.IntVar(&cfg.Port, "port", 8081, "HTTP listen port")
	flag.StringVar(&cfg.InstanceID, "instance", "v1-primary", "Instance identifier (e.g. v1-primary, v2-canary)")
	flag.StringVar(&cfg.DBPath, "db", "/var/lib/aurora-backend/store.db", "SQLite database path")
	flag.IntVar(&cfg.DiscountPercent, "discount", 0, "Canary discount promotional percentage (0-100)")
	flag.Parse()

	// Environment variable overrides
	if p, err := strconv.Atoi(os.Getenv("PORT")); err == nil && p > 0 {
		cfg.Port = p
	}
	if inst := os.Getenv("INSTANCE_ID"); inst != "" {
		cfg.InstanceID = inst
	}
	if dbp := os.Getenv("DB_PATH"); dbp != "" {
		cfg.DBPath = dbp
	}
	if disc, err := strconv.Atoi(os.Getenv("DISCOUNT_PERCENT")); err == nil {
		cfg.DiscountPercent = disc
	}

	log.Printf("Starting Aurora Real Backend [%s] on port :%d (DB: %s, Discount: %d%%)",
		cfg.InstanceID, cfg.Port, cfg.DBPath, cfg.DiscountPercent)

	db, err := initDB(cfg.DBPath)
	if err != nil {
		log.Fatalf("Database initialization failed: %v", err)
	}
	defer db.Close()

	if err := seedDatabase(db); err != nil {
		log.Fatalf("Database seeding failed: %v", err)
	}

	server := &Server{
		cfg: cfg,
		db:  db,
	}

	httpServer := &http.Server{
		Addr:         fmt.Sprintf("0.0.0.0:%d", cfg.Port),
		Handler:      server.routes(),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("HTTP server failed: %v", err)
		}
	}()

	log.Printf("Ready to serve requests on http://0.0.0.0:%d", cfg.Port)
	<-ctx.Done()

	log.Println("Shutting down Aurora Real Backend gracefully...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(shutdownCtx)
	log.Println("Aurora Real Backend stopped.")
}
