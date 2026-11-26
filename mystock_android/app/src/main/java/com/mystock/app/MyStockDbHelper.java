package com.mystock.app;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

public class MyStockDbHelper extends SQLiteOpenHelper {
    private static final String DB_NAME = "mystock.db";
    private static final int DB_VERSION = 2;

    public MyStockDbHelper(Context context) {
        super(context, DB_NAME, null, DB_VERSION);
    }

    @Override
    public void onConfigure(SQLiteDatabase db) {
        super.onConfigure(db);
        db.setForeignKeyConstraintsEnabled(true);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE IF NOT EXISTS produtos (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT," +
                "numero TEXT NOT NULL UNIQUE," +
                "codigo_barras TEXT," +
                "nome TEXT NOT NULL," +
                "estoque_minimo INTEGER NOT NULL DEFAULT 0)");
        db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS idx_produtos_codigo_barras " +
                "ON produtos(codigo_barras) WHERE codigo_barras IS NOT NULL AND codigo_barras != ''");

        db.execSQL("CREATE TABLE IF NOT EXISTS lotes (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT," +
                "produto_id INTEGER NOT NULL REFERENCES produtos(id)," +
                "lote TEXT NOT NULL," +
                "unidades_por_caixa INTEGER NOT NULL," +
                "fabricacao TEXT NOT NULL," +
                "vencimento TEXT NOT NULL," +
                "UNIQUE(produto_id, lote))");

        db.execSQL("CREATE TABLE IF NOT EXISTS enderecos (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT," +
                "codigo TEXT NOT NULL UNIQUE," +
                "capacidade_maxima INTEGER NOT NULL DEFAULT 0)");

        db.execSQL("CREATE TABLE IF NOT EXISTS estoque (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT," +
                "lote_id INTEGER NOT NULL REFERENCES lotes(id)," +
                "endereco_id INTEGER NOT NULL REFERENCES enderecos(id)," +
                "quantidade INTEGER NOT NULL DEFAULT 0," +
                "UNIQUE(lote_id, endereco_id))");

        db.execSQL("CREATE TABLE IF NOT EXISTS movimentacoes (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT," +
                "tipo TEXT NOT NULL," +
                "produto_numero TEXT NOT NULL," +
                "produto_nome TEXT NOT NULL," +
                "lote TEXT NOT NULL," +
                "endereco TEXT NOT NULL," +
                "quantidade INTEGER NOT NULL," +
                "saldo_apos INTEGER NOT NULL," +
                "data_hora TEXT NOT NULL)");

        db.execSQL("CREATE TABLE IF NOT EXISTS tarefas_movimentacao (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT," +
                "produto_id INTEGER NOT NULL REFERENCES produtos(id)," +
                "lote_id INTEGER NOT NULL REFERENCES lotes(id)," +
                "origem TEXT NOT NULL," +
                "destino TEXT NOT NULL," +
                "quantidade INTEGER NOT NULL CHECK(quantidade > 0)," +
                "status TEXT NOT NULL DEFAULT 'PENDENTE'," +
                "solicitado_por TEXT NOT NULL DEFAULT 'Operador'," +
                "criado_em TEXT NOT NULL," +
                "executado_por TEXT NOT NULL DEFAULT ''," +
                "executado_em TEXT NOT NULL DEFAULT ''," +
                "cancelado_por TEXT NOT NULL DEFAULT ''," +
                "cancelado_em TEXT NOT NULL DEFAULT '')");
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_tarefas_mov_status ON tarefas_movimentacao(status, criado_em DESC)");

        db.execSQL("CREATE TABLE IF NOT EXISTS pedidos (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT," +
                "numero TEXT NOT NULL UNIQUE," +
                "cliente TEXT NOT NULL DEFAULT ''," +
                "status TEXT NOT NULL DEFAULT 'PENDENTE'," +
                "criado_em TEXT NOT NULL," +
                "criado_por TEXT NOT NULL DEFAULT 'Operador')");

        db.execSQL("CREATE TABLE IF NOT EXISTS pedido_itens (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT," +
                "pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE," +
                "produto_id INTEGER NOT NULL REFERENCES produtos(id)," +
                "quantidade INTEGER NOT NULL CHECK(quantidade > 0)," +
                "status TEXT NOT NULL DEFAULT 'PENDENTE'," +
                "UNIQUE(pedido_id, produto_id))");

        db.execSQL("CREATE TABLE IF NOT EXISTS checkout_conferencias (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT," +
                "pedido_id INTEGER NOT NULL UNIQUE REFERENCES pedidos(id) ON DELETE CASCADE," +
                "status TEXT NOT NULL DEFAULT 'EM_CONFERENCIA'," +
                "iniciado_em TEXT NOT NULL," +
                "finalizado_em TEXT NOT NULL DEFAULT '')");

        db.execSQL("CREATE TABLE IF NOT EXISTS checkout_caixas (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT," +
                "conferencia_id INTEGER NOT NULL REFERENCES checkout_conferencias(id) ON DELETE CASCADE," +
                "pedido_item_id INTEGER NOT NULL REFERENCES pedido_itens(id)," +
                "produto_id INTEGER NOT NULL REFERENCES produtos(id)," +
                "lote_id INTEGER NOT NULL REFERENCES lotes(id)," +
                "codigo_lido TEXT NOT NULL," +
                "unidades INTEGER NOT NULL CHECK(unidades > 0)," +
                "lido_em TEXT NOT NULL)");

        db.execSQL("CREATE TABLE IF NOT EXISTS checkout_avulsas (" +
                "conferencia_id INTEGER NOT NULL REFERENCES checkout_conferencias(id) ON DELETE CASCADE," +
                "pedido_item_id INTEGER NOT NULL REFERENCES pedido_itens(id)," +
                "quantidade INTEGER NOT NULL DEFAULT 0 CHECK(quantidade >= 0)," +
                "atualizado_em TEXT NOT NULL," +
                "PRIMARY KEY(conferencia_id, pedido_item_id))");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        onCreate(db);
        if (!hasColumn(db, "produtos", "estoque_minimo")) {
            db.execSQL("ALTER TABLE produtos ADD COLUMN estoque_minimo INTEGER NOT NULL DEFAULT 0");
        }
    }

    private boolean hasColumn(SQLiteDatabase db, String table, String column) {
        try (Cursor c = db.rawQuery("PRAGMA table_info(" + table + ")", null)) {
            while (c.moveToNext()) {
                if (column.equalsIgnoreCase(c.getString(1))) return true;
            }
        }
        return false;
    }

    private JSONObject ok() throws Exception {
        JSONObject out = new JSONObject();
        out.put("ok", true);
        return out;
    }

    private String normalizeDate(String input) throws Exception {
        String value = input == null ? "" : input.trim();
        String[] formats = {"dd/MM/yyyy", "dd/MM/yy"};
        for (String f : formats) {
            try {
                SimpleDateFormat src = new SimpleDateFormat(f, Locale.US);
                src.setLenient(false);
                Date date = src.parse(value);
                if (date != null) {
                    return new SimpleDateFormat("dd/MM/yyyy", Locale.US).format(date);
                }
            } catch (ParseException ignored) {
            }
        }
        throw new Exception("Use datas válidas no formato DD/MM/AAAA ou DD/MM/AA.");
    }

    private String now() {
        return new SimpleDateFormat("dd/MM/yyyy HH:mm:ss", Locale.US).format(new Date());
    }

    private String todayStamp() {
        return new SimpleDateFormat("yyyyMMdd", Locale.US).format(new Date());
    }

    private Date parseDateBr(String ddMMyyyy) {
        try {
            SimpleDateFormat sdf = new SimpleDateFormat("dd/MM/yyyy", Locale.US);
            sdf.setLenient(false);
            return sdf.parse(ddMMyyyy);
        } catch (Exception ignored) {
            return null;
        }
    }

    private long daysUntil(String ddMMyyyy) {
        Date d = parseDateBr(ddMMyyyy);
        if (d == null) return 99999L;
        Calendar today = Calendar.getInstance();
        today.set(Calendar.HOUR_OF_DAY, 0);
        today.set(Calendar.MINUTE, 0);
        today.set(Calendar.SECOND, 0);
        today.set(Calendar.MILLISECOND, 0);

        Calendar target = Calendar.getInstance();
        target.setTime(d);
        target.set(Calendar.HOUR_OF_DAY, 0);
        target.set(Calendar.MINUTE, 0);
        target.set(Calendar.SECOND, 0);
        target.set(Calendar.MILLISECOND, 0);

        long diffMs = target.getTimeInMillis() - today.getTimeInMillis();
        return Math.round(diffMs / 86400000.0);
    }

    private long productId(SQLiteDatabase db, String numeroOrCode) {
        try (Cursor c = db.rawQuery(
                "SELECT id FROM produtos WHERE UPPER(numero) = UPPER(?) OR UPPER(COALESCE(codigo_barras, '')) = UPPER(?)",
                new String[]{numeroOrCode, numeroOrCode})) {
            return c.moveToFirst() ? c.getLong(0) : -1;
        }
    }

    private long addressId(SQLiteDatabase db, String codigo) {
        try (Cursor c = db.rawQuery("SELECT id FROM enderecos WHERE UPPER(codigo) = UPPER(?)", new String[]{codigo})) {
            return c.moveToFirst() ? c.getLong(0) : -1;
        }
    }

    private JSONObject rowToJson(Cursor c) throws Exception {
        JSONObject obj = new JSONObject();
        for (int i = 0; i < c.getColumnCount(); i++) {
            int type = c.getType(i);
            String name = c.getColumnName(i);
            if (type == Cursor.FIELD_TYPE_INTEGER) obj.put(name, c.getLong(i));
            else if (type == Cursor.FIELD_TYPE_FLOAT) obj.put(name, c.getDouble(i));
            else if (type == Cursor.FIELD_TYPE_NULL) obj.put(name, JSONObject.NULL);
            else obj.put(name, c.getString(i));
        }
        return obj;
    }

    private JSONArray rows(SQLiteDatabase db, String sql, String[] args) throws Exception {
        JSONArray arr = new JSONArray();
        try (Cursor c = db.rawQuery(sql, args)) {
            while (c.moveToNext()) arr.put(rowToJson(c));
        }
        return arr;
    }

    private long scalarLong(SQLiteDatabase db, String sql, String[] args) {
        try (Cursor c = db.rawQuery(sql, args)) {
            return c.moveToFirst() ? c.getLong(0) : 0L;
        }
    }

    private void addMovement(SQLiteDatabase db, String tipo, String produtoNumero, String produtoNome,
                             String lote, String endereco, long quantidade, long saldoApos) {
        db.execSQL("INSERT INTO movimentacoes(tipo, produto_numero, produto_nome, lote, endereco, quantidade, saldo_apos, data_hora) " +
                        "VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
                new Object[]{tipo, produtoNumero, produtoNome, lote, endereco, quantidade, saldoApos, now()});
    }

    /* ===================== DASHBOARD ===================== */

    public JSONObject getDashboardSummary(int alertDays) throws Exception {
        int days = alertDays > 0 ? alertDays : 30;
        SQLiteDatabase db = getReadableDatabase();

        long totalCapacidade = scalarLong(db, "SELECT COALESCE(SUM(capacidade_maxima), 0) FROM enderecos", null);
        long totalOcupado = scalarLong(db, "SELECT COALESCE(SUM(quantidade), 0) FROM estoque WHERE quantidade > 0", null);
        long totalEnderecos = scalarLong(db, "SELECT COUNT(*) FROM enderecos", null);
        long enderecosDisponiveis = scalarLong(db,
                "SELECT COUNT(*) FROM (" +
                        "SELECT en.id, en.capacidade_maxima - COALESCE(SUM(e.quantidade), 0) AS disp " +
                        "FROM enderecos en LEFT JOIN estoque e ON e.endereco_id = en.id " +
                        "GROUP BY en.id HAVING disp > 0)", null);
        long totalProdutos = scalarLong(db, "SELECT COUNT(*) FROM produtos", null);
        long totalLotes = scalarLong(db, "SELECT COUNT(*) FROM lotes", null);
        long pedidosPendentes = scalarLong(db, "SELECT COUNT(*) FROM pedidos WHERE status = 'PENDENTE'", null);
        long pedidosConcluidos = scalarLong(db, "SELECT COUNT(*) FROM pedidos WHERE status = 'CONCLUIDO'", null);
        long tarefasPendentes = scalarLong(db, "SELECT COUNT(*) FROM tarefas_movimentacao WHERE status IN ('PENDENTE', 'EM_EXECUCAO')", null);
        long totalMovs = scalarLong(db, "SELECT COUNT(*) FROM movimentacoes", null);

        JSONObject alertsObj = listOperationalAlerts(days);
        JSONArray alerts = alertsObj.getJSONArray("itens");
        int vencidos = 0, vencendo = 0, estoqueBaixo = 0;
        for (int i = 0; i < alerts.length(); i++) {
            String t = alerts.getJSONObject(i).optString("tipo");
            if ("VENCIDO".equals(t)) vencidos++;
            else if ("VENCIMENTO_PROXIMO".equals(t)) vencendo++;
            else if ("ESTOQUE_MINIMO".equals(t)) estoqueBaixo++;
        }

        JSONArray recentes = rows(db,
                "SELECT tipo, produto_numero, produto_nome, lote, endereco, quantidade, saldo_apos, data_hora " +
                        "FROM movimentacoes ORDER BY id DESC LIMIT 6", new String[]{});

        int taxaOcupacao = totalCapacidade > 0 ? (int) Math.min(100, Math.round((totalOcupado * 100.0) / totalCapacidade)) : 0;

        JSONObject out = ok();
        out.put("taxa_ocupacao", taxaOcupacao);
        out.put("total_ocupado", totalOcupado);
        out.put("total_capacidade", totalCapacidade);
        out.put("total_enderecos", totalEnderecos);
        out.put("enderecos_disponiveis", enderecosDisponiveis);
        out.put("total_produtos", totalProdutos);
        out.put("total_lotes", totalLotes);
        out.put("pedidos_pendentes", pedidosPendentes);
        out.put("pedidos_aguardando_checkout", pedidosConcluidos);
        out.put("tarefas_pendentes", tarefasPendentes);
        out.put("total_movimentacoes", totalMovs);
        out.put("alertas_total", alerts.length());
        out.put("alertas_vencidos", vencidos);
        out.put("alertas_vencendo", vencendo);
        out.put("alertas_estoque_minimo", estoqueBaixo);
        out.put("recentes", recentes);
        return out;
    }

    /* ===================== ENDEREÇOS ===================== */

    public JSONObject saveAddress(JSONObject data) throws Exception {
        String codigo = data.optString("codigo").trim().toUpperCase(Locale.US);
        int capacidade = data.optInt("capacidade_maxima", 0);
        if (codigo.isEmpty()) throw new Exception("Informe o código do endereço (ex.: A01-R01-N01).");
        if (capacidade <= 0) throw new Exception("O limite máximo precisa ser maior que zero.");

        SQLiteDatabase db = getWritableDatabase();
        long ocupado = scalarLong(db,
                "SELECT COALESCE(SUM(e.quantidade), 0) FROM enderecos en " +
                        "LEFT JOIN estoque e ON e.endereco_id = en.id WHERE UPPER(en.codigo) = UPPER(?)",
                new String[]{codigo});
        if (capacidade < ocupado) {
            throw new Exception("Este endereço já possui " + ocupado +
                    " unidade(s). O novo limite não pode ser menor que a ocupação atual.");
        }
        db.execSQL("INSERT OR IGNORE INTO enderecos(codigo, capacidade_maxima) VALUES(?, ?)",
                new Object[]{codigo, capacidade});
        db.execSQL("UPDATE enderecos SET capacidade_maxima = ? WHERE codigo = ?",
                new Object[]{capacidade, codigo});
        JSONObject out = ok();
        out.put("message", "Endereço " + codigo + " salvo com limite de " + capacidade + " un.");
        return out;
    }

    public JSONObject deleteAddress(String codigoRaw) throws Exception {
        String codigo = codigoRaw == null ? "" : codigoRaw.trim().toUpperCase(Locale.US);
        if (codigo.isEmpty()) throw new Exception("Informe o endereço.");
        SQLiteDatabase db = getWritableDatabase();
        long id = addressId(db, codigo);
        if (id < 0) throw new Exception("Endereço não encontrado.");
        long ocupado = scalarLong(db, "SELECT COALESCE(SUM(quantidade), 0) FROM estoque WHERE endereco_id = ?",
                new String[]{String.valueOf(id)});
        if (ocupado > 0) {
            throw new Exception("Não é possível remover o endereço " + codigo + " pois há " + ocupado + " unidade(s) armazenadas nele.");
        }
        db.execSQL("DELETE FROM estoque WHERE endereco_id = ? AND quantidade <= 0", new Object[]{id});
        db.execSQL("DELETE FROM enderecos WHERE id = ?", new Object[]{id});
        JSONObject out = ok();
        out.put("message", "Endereço " + codigo + " removido.");
        return out;
    }

    public JSONObject listAddresses(boolean onlyAvailable) throws Exception {
        String sql = "SELECT en.id, en.codigo, en.capacidade_maxima, " +
                "COALESCE(SUM(e.quantidade), 0) AS ocupado, " +
                "en.capacidade_maxima - COALESCE(SUM(e.quantidade), 0) AS disponivel, " +
                "COUNT(CASE WHEN e.quantidade > 0 THEN 1 END) AS total_itens " +
                "FROM enderecos en LEFT JOIN estoque e ON e.endereco_id = en.id " +
                "GROUP BY en.id, en.codigo, en.capacidade_maxima ";
        if (onlyAvailable) sql += "HAVING disponivel > 0 ";
        sql += "ORDER BY en.codigo";
        JSONObject out = ok();
        out.put("itens", rows(getReadableDatabase(), sql, new String[]{}));
        return out;
    }

    public JSONObject getAddressItems(String codigoRaw) throws Exception {
        String codigo = codigoRaw == null ? "" : codigoRaw.trim().toUpperCase(Locale.US);
        if (codigo.isEmpty()) throw new Exception("Informe o endereço.");
        JSONArray itens = rows(getReadableDatabase(),
                "SELECT p.id AS produto_id, l.id AS lote_id, p.numero, p.nome, l.lote, l.unidades_por_caixa, " +
                        "l.fabricacao, l.vencimento, en.codigo AS endereco, e.quantidade " +
                        "FROM estoque e JOIN lotes l ON l.id = e.lote_id " +
                        "JOIN produtos p ON p.id = l.produto_id " +
                        "JOIN enderecos en ON en.id = e.endereco_id " +
                        "WHERE UPPER(en.codigo) = UPPER(?) AND e.quantidade > 0 " +
                        "ORDER BY substr(l.vencimento, 7, 4) || '-' || substr(l.vencimento, 4, 2) || '-' || substr(l.vencimento, 1, 2), p.numero",
                new String[]{codigo});
        JSONObject out = ok();
        out.put("itens", itens);
        return out;
    }

    /* ===================== PRODUTOS & LOTES ===================== */

    public JSONObject saveProduct(JSONObject data) throws Exception {
        String numero = data.optString("numero").trim();
        String codigoBarras = data.optString("codigo_barras").trim();
        String nome = data.optString("nome").trim();
        String lote = data.optString("lote").trim();
        int qc = data.optInt("unidades_por_caixa", 0);
        int estoqueMinimo = Math.max(0, data.optInt("estoque_minimo", 0));
        String fabricacao = normalizeDate(data.optString("fabricacao"));
        String vencimento = normalizeDate(data.optString("vencimento"));
        String endereco = data.optString("endereco").trim().toUpperCase(Locale.US);
        int quantidadeEntrada = data.optInt("quantidade_entrada", 0);

        if (numero.isEmpty() || nome.isEmpty() || lote.isEmpty()) {
            throw new Exception("Informe número do produto, nome e lote.");
        }
        if (qc <= 0) throw new Exception("Unidades por caixa precisa ser maior que zero.");
        if (quantidadeEntrada > 0 && endereco.isEmpty()) {
            throw new Exception("Selecione um endereço para registrar a quantidade inicial.");
        }
        if (!endereco.isEmpty() && quantidadeEntrada <= 0) {
            throw new Exception("Informe a quantidade inicial para usar o endereço selecionado.");
        }

        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            db.execSQL("INSERT OR IGNORE INTO produtos(numero, codigo_barras, nome, estoque_minimo) VALUES(?, ?, ?, ?)",
                    new Object[]{numero, codigoBarras.isEmpty() ? null : codigoBarras, nome, estoqueMinimo});
            db.execSQL("UPDATE produtos SET codigo_barras = ?, nome = ?, estoque_minimo = ? WHERE numero = ?",
                    new Object[]{codigoBarras.isEmpty() ? null : codigoBarras, nome, estoqueMinimo, numero});
            long pid = productId(db, numero);
            db.execSQL("INSERT OR IGNORE INTO lotes(produto_id, lote, unidades_por_caixa, fabricacao, vencimento) VALUES(?, ?, ?, ?, ?)",
                    new Object[]{pid, lote, qc, fabricacao, vencimento});
            db.execSQL("UPDATE lotes SET unidades_por_caixa = ?, fabricacao = ?, vencimento = ? WHERE produto_id = ? AND lote = ?",
                    new Object[]{qc, fabricacao, vencimento, pid, lote});
            db.setTransactionSuccessful();
        } catch (Exception e) {
            String msg = e.getMessage() == null ? "" : e.getMessage();
            if (msg.contains("UNIQUE")) {
                throw new Exception("Código de barras já associado a outro produto.");
            }
            throw e;
        } finally {
            db.endTransaction();
        }

        if (quantidadeEntrada > 0) {
            JSONObject entrada = new JSONObject();
            entrada.put("numero", numero);
            entrada.put("lote", lote);
            entrada.put("endereco", endereco);
            entrada.put("quantidade", quantidadeEntrada);
            registerEntry(entrada);
            JSONObject out = ok();
            out.put("message", "Produto salvo e " + quantidadeEntrada + " un. endereçadas em " + endereco + ".");
            return out;
        }
        JSONObject out = ok();
        out.put("message", "Produto " + numero + " (Lote " + lote + ") salvo com sucesso.");
        return out;
    }

    public JSONObject editProduct(JSONObject data) throws Exception {
        long produtoId = data.optLong("produto_id", 0);
        long loteId = data.optLong("lote_id", 0);
        String numero = data.optString("numero").trim();
        String codigoBarras = data.optString("codigo_barras").trim();
        String nome = data.optString("nome").trim();
        String lote = data.optString("lote").trim();
        int qc = data.optInt("unidades_por_caixa", 0);
        int estoqueMinimo = Math.max(0, data.optInt("estoque_minimo", 0));
        String fabricacao = normalizeDate(data.optString("fabricacao"));
        String vencimento = normalizeDate(data.optString("vencimento"));

        if (produtoId <= 0 || loteId <= 0 || numero.isEmpty() || nome.isEmpty() || lote.isEmpty()) {
            throw new Exception("Confira produto, lote, número e nome.");
        }
        if (qc <= 0) throw new Exception("Unidades por caixa precisa ser maior que zero.");

        SQLiteDatabase db = getWritableDatabase();
        long exists = scalarLong(db, "SELECT COUNT(*) FROM lotes WHERE id = ? AND produto_id = ?",
                new String[]{String.valueOf(loteId), String.valueOf(produtoId)});
        if (exists == 0) throw new Exception("Produto ou lote não encontrado. Atualize o catálogo.");

        db.beginTransaction();
        try {
            db.execSQL("UPDATE produtos SET numero = ?, codigo_barras = ?, nome = ?, estoque_minimo = ? WHERE id = ?",
                    new Object[]{numero, codigoBarras.isEmpty() ? null : codigoBarras, nome, estoqueMinimo, produtoId});
            db.execSQL("UPDATE lotes SET lote = ?, unidades_por_caixa = ?, fabricacao = ?, vencimento = ? WHERE id = ?",
                    new Object[]{lote, qc, fabricacao, vencimento, loteId});
            db.setTransactionSuccessful();
        } catch (Exception e) {
            String msg = e.getMessage() == null ? "" : e.getMessage();
            if (msg.contains("UNIQUE")) {
                throw new Exception("Número, código de barras ou lote já cadastrado em outro registro.");
            }
            throw e;
        } finally {
            db.endTransaction();
        }
        JSONObject out = ok();
        out.put("message", "Cadastro atualizado com sucesso.");
        return out;
    }

    public JSONObject listProducts(String filtro) throws Exception {
        String sql = "SELECT p.id AS produto_id, l.id AS lote_id, p.numero, p.codigo_barras, p.nome, p.estoque_minimo, " +
                "(SELECT COALESCE(SUM(e2.quantidade), 0) FROM estoque e2 JOIN lotes l2 ON l2.id = e2.lote_id WHERE l2.produto_id = p.id) AS saldo_produto, " +
                "l.lote, l.unidades_por_caixa, l.fabricacao, l.vencimento, " +
                "COALESCE(SUM(e.quantidade), 0) AS saldo_total FROM produtos p " +
                "JOIN lotes l ON l.produto_id = p.id LEFT JOIN estoque e ON e.lote_id = l.id ";
        String[] args = new String[]{};
        if (filtro != null && !filtro.trim().isEmpty()) {
            String t = "%" + filtro.trim() + "%";
            sql += "WHERE p.numero LIKE ? OR COALESCE(p.codigo_barras,'') LIKE ? OR p.nome LIKE ? OR l.lote LIKE ? ";
            args = new String[]{t, t, t, t};
        }
        sql += "GROUP BY p.id, p.numero, p.codigo_barras, p.nome, p.estoque_minimo, l.id, l.lote, l.unidades_por_caixa, l.fabricacao, l.vencimento " +
                "ORDER BY p.numero, substr(l.vencimento, 7, 4) || '-' || substr(l.vencimento, 4, 2) || '-' || substr(l.vencimento, 1, 2), l.lote";
        JSONArray arr = rows(getReadableDatabase(), sql, args);
        for (int i = 0; i < arr.length(); i++) {
            JSONObject item = arr.getJSONObject(i);
            item.put("dias_vencimento", daysUntil(item.optString("vencimento")));
        }
        JSONObject out = ok();
        out.put("itens", arr);
        return out;
    }

    public JSONObject listUniqueProducts(String filtro) throws Exception {
        String sql = "SELECT p.id AS produto_id, p.numero, p.codigo_barras, p.nome, p.estoque_minimo, " +
                "COALESCE(SUM(e.quantidade), 0) AS saldo_total " +
                "FROM produtos p LEFT JOIN lotes l ON l.produto_id = p.id LEFT JOIN estoque e ON e.lote_id = l.id ";
        String[] args = new String[]{};
        if (filtro != null && !filtro.trim().isEmpty()) {
            String t = "%" + filtro.trim() + "%";
            sql += "WHERE p.numero LIKE ? OR COALESCE(p.codigo_barras,'') LIKE ? OR p.nome LIKE ? ";
            args = new String[]{t, t, t};
        }
        sql += "GROUP BY p.id, p.numero, p.codigo_barras, p.nome, p.estoque_minimo ORDER BY p.nome, p.numero";
        JSONObject out = ok();
        out.put("itens", rows(getReadableDatabase(), sql, args));
        return out;
    }

    public JSONObject listLots(String produto) throws Exception {
        String filtro = produto == null ? "" : produto.trim();
        if (filtro.isEmpty()) throw new Exception("Informe o produto.");
        JSONArray arr = rows(getReadableDatabase(),
                "SELECT p.id AS produto_id, l.id AS lote_id, p.numero, p.codigo_barras, p.nome, l.lote, " +
                        "l.unidades_por_caixa, l.fabricacao, l.vencimento, COALESCE(SUM(e.quantidade), 0) AS saldo_total " +
                        "FROM lotes l JOIN produtos p ON p.id = l.produto_id LEFT JOIN estoque e ON e.lote_id = l.id " +
                        "WHERE UPPER(p.numero) = UPPER(?) OR UPPER(COALESCE(p.codigo_barras,'')) = UPPER(?) " +
                        "GROUP BY l.id " +
                        "ORDER BY substr(l.vencimento, 7, 4) || '-' || substr(l.vencimento, 4, 2) || '-' || substr(l.vencimento, 1, 2), l.lote",
                new String[]{filtro, filtro});
        JSONObject out = ok();
        out.put("itens", arr);
        return out;
    }

    /* ===================== ENTRADA & ESTOQUE ===================== */

    public JSONObject registerEntry(JSONObject data) throws Exception {
        String numero = data.optString("numero").trim();
        String lote = data.optString("lote").trim();
        String endereco = data.optString("endereco").trim().toUpperCase(Locale.US);
        int quantidade = data.optInt("quantidade", 0);
        if (numero.isEmpty() || lote.isEmpty() || endereco.isEmpty()) {
            throw new Exception("Informe produto, lote e endereço.");
        }
        if (quantidade <= 0) throw new Exception("Quantidade de entrada precisa ser maior que zero.");

        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            long loteId;
            String produtoNumero;
            String produtoNome;
            String loteReal;
            try (Cursor c = db.rawQuery(
                    "SELECT l.id, p.numero, p.nome, l.lote FROM lotes l JOIN produtos p ON p.id = l.produto_id " +
                            "WHERE (UPPER(p.numero) = UPPER(?) OR UPPER(COALESCE(p.codigo_barras,'')) = UPPER(?)) AND UPPER(l.lote) = UPPER(?)",
                    new String[]{numero, numero, lote})) {
                if (!c.moveToFirst()) throw new Exception("Produto ou lote não encontrado. Cadastre primeiro.");
                loteId = c.getLong(0);
                produtoNumero = c.getString(1);
                produtoNome = c.getString(2);
                loteReal = c.getString(3);
            }
            long enderecoId = addressId(db, endereco);
            if (enderecoId < 0) {
                throw new Exception("Endereço não cadastrado. Cadastre o endereço e sua capacidade primeiro.");
            }

            long capacidade;
            long ocupado;
            try (Cursor c = db.rawQuery(
                    "SELECT en.capacidade_maxima, COALESCE(SUM(e.quantidade), 0) AS ocupado " +
                            "FROM enderecos en LEFT JOIN estoque e ON e.endereco_id = en.id " +
                            "WHERE en.id = ? GROUP BY en.id, en.capacidade_maxima",
                    new String[]{String.valueOf(enderecoId)})) {
                c.moveToFirst();
                capacidade = c.getLong(0);
                ocupado = c.getLong(1);
            }
            long disponivel = capacidade - ocupado;
            if (quantidade > disponivel) {
                throw new Exception("Capacidade insuficiente no endereço " + endereco +
                        ". Disponível: " + disponivel + " un. | Entrada: " + quantidade + " un.");
            }

            db.execSQL("INSERT OR IGNORE INTO estoque(lote_id, endereco_id, quantidade) VALUES(?, ?, 0)",
                    new Object[]{loteId, enderecoId});
            db.execSQL("UPDATE estoque SET quantidade = quantidade + ? WHERE lote_id = ? AND endereco_id = ?",
                    new Object[]{quantidade, loteId, enderecoId});
            long saldo = scalarLong(db, "SELECT quantidade FROM estoque WHERE lote_id = ? AND endereco_id = ?",
                    new String[]{String.valueOf(loteId), String.valueOf(enderecoId)});

            addMovement(db, "ENTRADA", produtoNumero, produtoNome, loteReal, endereco, quantidade, saldo);
            db.setTransactionSuccessful();
            JSONObject out = ok();
            out.put("saldo", saldo);
            out.put("message", "Entrada de " + quantidade + " un. registrada em " + endereco + ". Saldo atual: " + saldo + " un.");
            return out;
        } finally {
            db.endTransaction();
        }
    }

    public JSONObject listStock(String filtro) throws Exception {
        String sql = "SELECT e.id AS estoque_id, p.id AS produto_id, l.id AS lote_id, p.numero, p.codigo_barras, p.nome, " +
                "p.estoque_minimo, l.lote, l.unidades_por_caixa, l.fabricacao, l.vencimento, " +
                "en.codigo AS endereco, e.quantidade FROM estoque e " +
                "JOIN lotes l ON l.id = e.lote_id JOIN produtos p ON p.id = l.produto_id " +
                "JOIN enderecos en ON en.id = e.endereco_id WHERE e.quantidade > 0 ";
        String[] args = new String[]{};
        if (filtro != null && !filtro.trim().isEmpty()) {
            String exact = filtro.trim();
            String like = "%" + exact + "%";
            sql += "AND (UPPER(p.numero) = UPPER(?) OR UPPER(COALESCE(p.codigo_barras,'')) = UPPER(?) " +
                    "OR p.nome LIKE ? OR l.lote LIKE ? OR en.codigo LIKE ?) ";
            args = new String[]{exact, exact, like, like, like};
        }
        sql += "ORDER BY p.numero, substr(l.vencimento, 7, 4) || '-' || substr(l.vencimento, 4, 2) || '-' || substr(l.vencimento, 1, 2), en.codigo";
        JSONArray arr = rows(getReadableDatabase(), sql, args);
        for (int i = 0; i < arr.length(); i++) {
            JSONObject item = arr.getJSONObject(i);
            item.put("dias_vencimento", daysUntil(item.optString("vencimento")));
        }
        JSONObject out = ok();
        out.put("itens", arr);
        return out;
    }

    /* ===================== TRANSFERÊNCIAS & TAREFAS ===================== */

    public JSONObject moveStock(JSONObject data) throws Exception {
        String numero = data.optString("numero").trim();
        String lote = data.optString("lote").trim();
        long produtoId = data.optLong("produto_id", 0);
        long loteId = data.optLong("lote_id", 0);
        String origem = data.optString("origem").trim().toUpperCase(Locale.US);
        String destino = data.optString("destino").trim().toUpperCase(Locale.US);
        int quantidade = data.optInt("quantidade", 0);

        if (origem.isEmpty() || destino.isEmpty()) throw new Exception("Informe endereço de origem e destino.");
        if (origem.equals(destino)) throw new Exception("Origem e destino precisam ser diferentes.");
        if (quantidade <= 0) throw new Exception("A quantidade precisa ser maior que zero.");

        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            String prodNumero;
            String prodNome;
            String loteReal;
            if (produtoId > 0 && loteId > 0) {
                try (Cursor c = db.rawQuery(
                        "SELECT p.id, l.id, p.numero, p.nome, l.lote FROM produtos p JOIN lotes l ON l.produto_id = p.id WHERE p.id = ? AND l.id = ?",
                        new String[]{String.valueOf(produtoId), String.valueOf(loteId)})) {
                    if (!c.moveToFirst()) throw new Exception("Produto ou lote não encontrado.");
                    produtoId = c.getLong(0);
                    loteId = c.getLong(1);
                    prodNumero = c.getString(2);
                    prodNome = c.getString(3);
                    loteReal = c.getString(4);
                }
            } else {
                if (numero.isEmpty() || lote.isEmpty()) throw new Exception("Informe produto e lote.");
                try (Cursor c = db.rawQuery(
                        "SELECT p.id, l.id, p.numero, p.nome, l.lote FROM produtos p JOIN lotes l ON l.produto_id = p.id " +
                                "WHERE (UPPER(p.numero) = UPPER(?) OR UPPER(COALESCE(p.codigo_barras,'')) = UPPER(?)) AND UPPER(l.lote) = UPPER(?)",
                        new String[]{numero, numero, lote})) {
                    if (!c.moveToFirst()) throw new Exception("Produto ou lote não encontrado.");
                    produtoId = c.getLong(0);
                    loteId = c.getLong(1);
                    prodNumero = c.getString(2);
                    prodNome = c.getString(3);
                    loteReal = c.getString(4);
                }
            }

            long fromEndId;
            long fromQty;
            try (Cursor c = db.rawQuery(
                    "SELECT en.id, e.quantidade FROM enderecos en JOIN estoque e ON e.endereco_id = en.id " +
                            "WHERE UPPER(en.codigo) = UPPER(?) AND e.lote_id = ?",
                    new String[]{origem, String.valueOf(loteId)})) {
                if (!c.moveToFirst()) throw new Exception("Lote não encontrado no endereço de origem " + origem + ".");
                fromEndId = c.getLong(0);
                fromQty = c.getLong(1);
            }
            if (fromQty < quantidade) {
                throw new Exception("Saldo insuficiente na origem " + origem + ". Disponível: " + fromQty + " un.");
            }

            long toEndId;
            long toCap;
            try (Cursor c = db.rawQuery("SELECT id, capacidade_maxima FROM enderecos WHERE UPPER(codigo) = UPPER(?)",
                    new String[]{destino})) {
                if (!c.moveToFirst()) throw new Exception("Endereço de destino " + destino + " não cadastrado.");
                toEndId = c.getLong(0);
                toCap = c.getLong(1);
            }
            long toOccupied = scalarLong(db, "SELECT COALESCE(SUM(quantidade), 0) FROM estoque WHERE endereco_id = ?",
                    new String[]{String.valueOf(toEndId)});
            long toFree = toCap - toOccupied;
            if (quantidade > toFree) {
                throw new Exception("Capacidade insuficiente no destino " + destino + ". Espaço livre: " + toFree + " un.");
            }

            db.execSQL("UPDATE estoque SET quantidade = quantidade - ? WHERE lote_id = ? AND endereco_id = ?",
                    new Object[]{quantidade, loteId, fromEndId});
            db.execSQL("DELETE FROM estoque WHERE lote_id = ? AND endereco_id = ? AND quantidade <= 0",
                    new Object[]{loteId, fromEndId});
            db.execSQL("INSERT OR IGNORE INTO estoque(lote_id, endereco_id, quantidade) VALUES(?, ?, 0)",
                    new Object[]{loteId, toEndId});
            db.execSQL("UPDATE estoque SET quantidade = quantidade + ? WHERE lote_id = ? AND endereco_id = ?",
                    new Object[]{quantidade, loteId, toEndId});

            long saldoOrigem = scalarLong(db, "SELECT COALESCE(SUM(quantidade), 0) FROM estoque WHERE lote_id = ? AND endereco_id = ?",
                    new String[]{String.valueOf(loteId), String.valueOf(fromEndId)});
            long saldoDestino = scalarLong(db, "SELECT COALESCE(SUM(quantidade), 0) FROM estoque WHERE lote_id = ? AND endereco_id = ?",
                    new String[]{String.valueOf(loteId), String.valueOf(toEndId)});

            addMovement(db, "SAIDA_TRANSFERENCIA", prodNumero, prodNome, loteReal, origem, -quantidade, saldoOrigem);
            addMovement(db, "ENTRADA_TRANSFERENCIA", prodNumero, prodNome, loteReal, destino, quantidade, saldoDestino);
            db.setTransactionSuccessful();

            JSONObject out = ok();
            out.put("saldo_origem", saldoOrigem);
            out.put("saldo_destino", saldoDestino);
            out.put("message", "Transferência concluída: " + quantidade + " un. de " + origem + " → " + destino + ".");
            return out;
        } finally {
            db.endTransaction();
        }
    }

    public JSONObject createMoveTask(JSONObject data, String operador) throws Exception {
        String numero = data.optString("numero").trim();
        String lote = data.optString("lote").trim();
        String origem = data.optString("origem").trim().toUpperCase(Locale.US);
        String destino = data.optString("destino").trim().toUpperCase(Locale.US);
        int quantidade = data.optInt("quantidade", 0);

        if (numero.isEmpty() || lote.isEmpty() || origem.isEmpty() || destino.isEmpty()) {
            throw new Exception("Informe produto, lote, origem e destino.");
        }
        if (origem.equals(destino)) throw new Exception("Origem e destino precisam ser diferentes.");
        if (quantidade <= 0) throw new Exception("A quantidade precisa ser maior que zero.");

        SQLiteDatabase db = getWritableDatabase();
        long produtoId, loteId;
        try (Cursor c = db.rawQuery(
                "SELECT p.id, l.id FROM produtos p JOIN lotes l ON l.produto_id = p.id " +
                        "WHERE (UPPER(p.numero) = UPPER(?) OR UPPER(COALESCE(p.codigo_barras,'')) = UPPER(?)) AND UPPER(l.lote) = UPPER(?)",
                new String[]{numero, numero, lote})) {
            if (!c.moveToFirst()) throw new Exception("Produto ou lote não encontrado.");
            produtoId = c.getLong(0);
            loteId = c.getLong(1);
        }
        long fromQty = scalarLong(db,
                "SELECT COALESCE(e.quantidade, 0) FROM estoque e JOIN enderecos en ON en.id = e.endereco_id " +
                        "WHERE UPPER(en.codigo) = UPPER(?) AND e.lote_id = ?",
                new String[]{origem, String.valueOf(loteId)});
        if (fromQty < quantidade) throw new Exception("Saldo insuficiente na origem (" + fromQty + " un. disponíveis).");

        long toEndId = addressId(db, destino);
        if (toEndId < 0) throw new Exception("Endereço de destino não cadastrado.");

        db.execSQL("INSERT INTO tarefas_movimentacao(produto_id, lote_id, origem, destino, quantidade, status, solicitado_por, criado_em) " +
                        "VALUES(?, ?, ?, ?, ?, 'PENDENTE', ?, ?)",
                new Object[]{produtoId, loteId, origem, destino, quantidade,
                        (operador == null || operador.isEmpty()) ? "Operador" : operador, now()});
        JSONObject out = ok();
        out.put("message", "Tarefa de movimentação criada (" + quantidade + " un. de " + origem + " → " + destino + ").");
        return out;
    }

    public JSONObject listMoveTasks(String statusFilter) throws Exception {
        String f = statusFilter == null ? "" : statusFilter.trim().toUpperCase(Locale.US);
        String sql = "SELECT t.id, t.produto_id, t.lote_id, p.numero AS produto_numero, p.nome AS produto_nome, " +
                "l.lote, l.vencimento, t.origem, t.destino, t.quantidade, t.status, t.solicitado_por, t.criado_em, " +
                "t.executado_por, t.executado_em, t.cancelado_por, t.cancelado_em " +
                "FROM tarefas_movimentacao t JOIN produtos p ON p.id = t.produto_id JOIN lotes l ON l.id = t.lote_id ";
        String[] args = new String[]{};
        if ("PENDENTE".equals(f) || "EM_EXECUCAO".equals(f) || "CONCLUIDA".equals(f) || "CANCELADA".equals(f)) {
            sql += "WHERE t.status = ? ";
            args = new String[]{f};
        }
        sql += "ORDER BY CASE t.status WHEN 'PENDENTE' THEN 0 WHEN 'EM_EXECUCAO' THEN 1 ELSE 2 END, t.id DESC LIMIT 200";
        JSONObject out = ok();
        out.put("itens", rows(getReadableDatabase(), sql, args));
        return out;
    }

    public JSONObject executeMoveTask(JSONObject data, String operador) throws Exception {
        long id = data.optLong("id", 0);
        int confirmed = data.optInt("quantidade_confirmada", 0);
        if (id <= 0) throw new Exception("Tarefa inválida.");
        if (confirmed <= 0) throw new Exception("Informe a quantidade confirmada.");

        SQLiteDatabase db = getWritableDatabase();
        long produtoId, loteId;
        String origem, destino, status;
        int requested;
        try (Cursor c = db.rawQuery(
                "SELECT produto_id, lote_id, origem, destino, quantidade, status FROM tarefas_movimentacao WHERE id = ?",
                new String[]{String.valueOf(id)})) {
            if (!c.moveToFirst()) throw new Exception("Tarefa não encontrada.");
            produtoId = c.getLong(0);
            loteId = c.getLong(1);
            origem = c.getString(2);
            destino = c.getString(3);
            requested = c.getInt(4);
            status = c.getString(5);
        }
        if (!"PENDENTE".equals(status) && !"EM_EXECUCAO".equals(status)) {
            throw new Exception("Esta tarefa já foi encerrada.");
        }
        if (confirmed != requested) {
            throw new Exception("Quantidade confirmada (" + confirmed + ") diverge da tarefa (" + requested + ").");
        }

        JSONObject movePayload = new JSONObject();
        movePayload.put("produto_id", produtoId);
        movePayload.put("lote_id", loteId);
        movePayload.put("origem", origem);
        movePayload.put("destino", destino);
        movePayload.put("quantidade", confirmed);
        JSONObject res = moveStock(movePayload);

        db.execSQL("UPDATE tarefas_movimentacao SET status = 'CONCLUIDA', executado_por = ?, executado_em = ? WHERE id = ?",
                new Object[]{(operador == null || operador.isEmpty()) ? "Operador" : operador, now(), id});
        JSONObject out = ok();
        out.put("message", "Tarefa #" + id + " concluída. " + res.optString("message"));
        return out;
    }

    public JSONObject cancelMoveTask(long id, String operador) throws Exception {
        if (id <= 0) throw new Exception("Tarefa inválida.");
        SQLiteDatabase db = getWritableDatabase();
        long count = scalarLong(db, "SELECT COUNT(*) FROM tarefas_movimentacao WHERE id = ? AND status = 'PENDENTE'",
                new String[]{String.valueOf(id)});
        if (count == 0) throw new Exception("Somente tarefas pendentes podem ser canceladas.");
        db.execSQL("UPDATE tarefas_movimentacao SET status = 'CANCELADA', cancelado_por = ?, cancelado_em = ? WHERE id = ?",
                new Object[]{(operador == null || operador.isEmpty()) ? "Operador" : operador, now(), id});
        JSONObject out = ok();
        out.put("message", "Tarefa #" + id + " cancelada.");
        return out;
    }

    /* ===================== PEDIDOS / ORDENS ===================== */

    public JSONObject createOrder(JSONObject data, String operador) throws Exception {
        String cliente = data.optString("cliente", "").trim();
        JSONArray items = data.optJSONArray("itens");
        if (items == null || items.length() == 0) {
            throw new Exception("Adicione pelo menos um produto à ordem.");
        }
        Map<Long, Integer> aggregated = new LinkedHashMap<>();
        for (int i = 0; i < items.length(); i++) {
            JSONObject it = items.getJSONObject(i);
            long pid = it.optLong("produto_id", 0);
            int qty = it.optInt("quantidade", 0);
            if (pid <= 0 || qty <= 0) throw new Exception("Cada item precisa de produto e quantidade maior que zero.");
            aggregated.put(pid, (aggregated.containsKey(pid) ? aggregated.get(pid) : 0) + qty);
        }

        SQLiteDatabase db = getWritableDatabase();
        String prefix = "ORD-" + todayStamp() + "-";
        String orderNo;
        db.beginTransaction();
        try {
            long seq = scalarLong(db, "SELECT COUNT(*) FROM pedidos WHERE numero LIKE ?", new String[]{prefix + "%"}) + 1;
            orderNo = prefix + String.format(Locale.US, "%04d", seq);
            while (scalarLong(db, "SELECT COUNT(*) FROM pedidos WHERE numero = ?", new String[]{orderNo}) > 0) {
                seq++;
                orderNo = prefix + String.format(Locale.US, "%04d", seq);
            }
            db.execSQL("INSERT INTO pedidos(numero, cliente, status, criado_em, criado_por) VALUES(?, ?, 'PENDENTE', ?, ?)",
                    new Object[]{orderNo, cliente, now(), (operador == null || operador.isEmpty()) ? "Operador" : operador});
            long pedidoId = scalarLong(db, "SELECT id FROM pedidos WHERE numero = ?", new String[]{orderNo});
            for (Map.Entry<Long, Integer> entry : aggregated.entrySet()) {
                if (scalarLong(db, "SELECT COUNT(*) FROM produtos WHERE id = ?",
                        new String[]{String.valueOf(entry.getKey())}) == 0) {
                    throw new Exception("Um dos produtos selecionados não existe mais.");
                }
                db.execSQL("INSERT INTO pedido_itens(pedido_id, produto_id, quantidade, status) VALUES(?, ?, ?, 'PENDENTE')",
                        new Object[]{pedidoId, entry.getKey(), entry.getValue()});
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
        JSONObject out = ok();
        out.put("numero", orderNo);
        out.put("message", "Ordem " + orderNo + " criada com sucesso.");
        return out;
    }

    public JSONObject listOrders(String filtro) throws Exception {
        String f = filtro == null ? "" : filtro.trim();
        String sql = "SELECT p.id, p.numero, p.cliente, p.status, p.criado_em, p.criado_por, " +
                "COUNT(i.id) AS total_itens, " +
                "SUM(CASE WHEN i.status = 'CONCLUIDO' THEN 1 ELSE 0 END) AS itens_concluidos, " +
                "COALESCE(SUM(i.quantidade), 0) AS total_unidades " +
                "FROM pedidos p LEFT JOIN pedido_itens i ON i.pedido_id = p.id ";
        String[] args = new String[]{};
        if (!f.isEmpty()) {
            String like = "%" + f + "%";
            sql += "WHERE p.numero LIKE ? OR p.cliente LIKE ? OR p.status LIKE ? ";
            args = new String[]{like, like, like};
        }
        sql += "GROUP BY p.id ORDER BY CASE p.status WHEN 'PENDENTE' THEN 0 WHEN 'CONCLUIDO' THEN 1 WHEN 'EXPEDIDO' THEN 2 ELSE 3 END, p.id DESC LIMIT 100";
        JSONObject out = ok();
        out.put("itens", rows(getReadableDatabase(), sql, args));
        return out;
    }

    public JSONObject getOrder(String numeroRaw) throws Exception {
        String numero = numeroRaw == null ? "" : numeroRaw.trim().toUpperCase(Locale.US);
        if (numero.isEmpty()) throw new Exception("Informe o número da ordem.");
        SQLiteDatabase db = getReadableDatabase();
        JSONArray pArr = rows(db, "SELECT id, numero, cliente, status, criado_em, criado_por FROM pedidos WHERE UPPER(numero) = UPPER(?)",
                new String[]{numero});
        if (pArr.length() == 0) throw new Exception("Ordem " + numero + " não encontrada.");
        JSONObject pedido = pArr.getJSONObject(0);
        JSONArray itens = rows(db,
                "SELECT i.id AS item_id, i.produto_id, p.numero AS produto_numero, p.codigo_barras, p.nome, i.quantidade, i.status " +
                        "FROM pedido_itens i JOIN produtos p ON p.id = i.produto_id WHERE i.pedido_id = ? ORDER BY i.id",
                new String[]{String.valueOf(pedido.getLong("id"))});
        JSONObject out = ok();
        out.put("pedido", pedido);
        out.put("itens", itens);
        return out;
    }

    public JSONObject cancelOrder(String numeroRaw) throws Exception {
        String numero = numeroRaw == null ? "" : numeroRaw.trim().toUpperCase(Locale.US);
        SQLiteDatabase db = getWritableDatabase();
        long count = scalarLong(db, "SELECT COUNT(*) FROM pedidos WHERE UPPER(numero) = UPPER(?) AND status = 'PENDENTE'",
                new String[]{numero});
        if (count == 0) throw new Exception("Somente ordens pendentes podem ser canceladas.");
        db.execSQL("UPDATE pedidos SET status = 'CANCELADO' WHERE UPPER(numero) = UPPER(?)", new Object[]{numero});
        JSONObject out = ok();
        out.put("message", "Ordem " + numero + " cancelada.");
        return out;
    }

    /* ===================== SEPARAÇÃO FEFO ===================== */

    public JSONObject previewSeparation(JSONObject data) throws Exception {
        String numero = data.optString("numero").trim();
        int quantidadePedida = data.optInt("quantidade", 0);
        if (numero.isEmpty() || quantidadePedida <= 0) {
            throw new Exception("Informe produto e quantidade válida.");
        }

        JSONArray saldos = rows(getReadableDatabase(),
                "SELECT e.id AS estoque_id, p.numero, p.nome, l.lote, l.unidades_por_caixa, l.vencimento, en.codigo AS endereco, e.quantidade " +
                        "FROM estoque e JOIN lotes l ON l.id = e.lote_id JOIN produtos p ON p.id = l.produto_id " +
                        "JOIN enderecos en ON en.id = e.endereco_id " +
                        "WHERE (UPPER(p.numero) = UPPER(?) OR UPPER(COALESCE(p.codigo_barras,'')) = UPPER(?)) AND e.quantidade > 0 " +
                        "ORDER BY substr(l.vencimento, 7, 4) || '-' || substr(l.vencimento, 4, 2) || '-' || substr(l.vencimento, 1, 2), en.codigo",
                new String[]{numero, numero});
        if (saldos.length() == 0) throw new Exception("Produto não encontrado em estoque.");

        long total = 0;
        for (int i = 0; i < saldos.length(); i++) total += saldos.getJSONObject(i).getLong("quantidade");
        if (total < quantidadePedida) {
            throw new Exception("Saldo insuficiente. Disponível: " + total + " un. | Solicitado: " + quantidadePedida + " un.");
        }

        int restante = quantidadePedida;
        JSONArray orientacoes = new JSONArray();
        for (int i = 0; i < saldos.length() && restante > 0; i++) {
            JSONObject s = saldos.getJSONObject(i);
            int retirar = Math.min(restante, s.getInt("quantidade"));
            int qc = s.getInt("unidades_por_caixa");
            int qtdOperador = retirar % qc == 0 ? retirar / qc : retirar;
            String unidadeOperador = retirar % qc == 0 ? "caixa(s)" : "unidade(s)";
            JSONObject o = new JSONObject();
            o.put("estoque_id", s.getLong("estoque_id"));
            o.put("produto", s.getString("numero"));
            o.put("nome", s.getString("nome"));
            o.put("lote", s.getString("lote"));
            o.put("vencimento", s.getString("vencimento"));
            o.put("endereco", s.getString("endereco"));
            o.put("unidades_por_caixa", qc);
            o.put("quantidade_baixa", retirar);
            o.put("qtd_operador", qtdOperador);
            o.put("unidade_operador", unidadeOperador);
            orientacoes.put(o);
            restante -= retirar;
        }
        JSONObject token = new JSONObject();
        token.put("id", UUID.randomUUID().toString());
        token.put("orientacoes", orientacoes);

        JSONObject out = ok();
        out.put("token", token.toString());
        out.put("produto", orientacoes.getJSONObject(0).getString("produto"));
        out.put("nome", orientacoes.getJSONObject(0).getString("nome"));
        out.put("quantidade_pedida", quantidadePedida);
        out.put("orientacoes", orientacoes);
        return out;
    }

    public JSONObject confirmSeparation(JSONObject data) throws Exception {
        JSONObject token = new JSONObject(data.optString("token"));
        JSONArray orientacoes = token.getJSONArray("orientacoes");
        JSONArray confirmacoes = data.getJSONArray("confirmacoes");
        if (orientacoes.length() == 0 || confirmacoes.length() != orientacoes.length()) {
            throw new Exception("Confirmação incompleta. Gere a orientação novamente.");
        }
        for (int i = 0; i < orientacoes.length(); i++) {
            int esperado = orientacoes.getJSONObject(i).getInt("qtd_operador");
            int confirmado = confirmacoes.getJSONObject(i).optInt("quantidade_confirmada", -1);
            if (esperado != confirmado) {
                throw new Exception("Quantidade confirmada no item " + (i + 1) +
                        " difere da orientação (" + esperado + "). Estoque não alterado.");
            }
        }

        long pedidoId = data.optLong("pedido_id", 0);
        long pedidoItemId = data.optLong("pedido_item_id", 0);

        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            if (pedidoItemId > 0) {
                if (pedidoId <= 0) throw new Exception("Ordem inválida.");
                try (Cursor c = db.rawQuery(
                        "SELECT i.pedido_id, i.status, i.quantidade, p.numero FROM pedido_itens i JOIN produtos p ON p.id = i.produto_id WHERE i.id = ?",
                        new String[]{String.valueOf(pedidoItemId)})) {
                    if (!c.moveToFirst() || c.getLong(0) != pedidoId || !"PENDENTE".equals(c.getString(1))) {
                        throw new Exception("Este item da ordem já foi separado ou não pertence a ela.");
                    }
                    int totalBaixa = 0;
                    for (int i = 0; i < orientacoes.length(); i++) {
                        totalBaixa += orientacoes.getJSONObject(i).getInt("quantidade_baixa");
                    }
                    if (totalBaixa != c.getInt(2)) {
                        throw new Exception("A orientação não corresponde à quantidade da ordem.");
                    }
                }
            }

            for (int i = 0; i < orientacoes.length(); i++) {
                JSONObject o = orientacoes.getJSONObject(i);
                long estoqueId = o.getLong("estoque_id");
                int baixa = o.getInt("quantidade_baixa");
                long atual;
                try (Cursor c = db.rawQuery("SELECT quantidade FROM estoque WHERE id = ?",
                        new String[]{String.valueOf(estoqueId)})) {
                    if (!c.moveToFirst()) throw new Exception("Estoque não encontrado. Gere a orientação novamente.");
                    atual = c.getLong(0);
                }
                if (atual < baixa) throw new Exception("Saldo mudou e ficou insuficiente. Gere a orientação novamente.");
                long novoSaldo = atual - baixa;
                if (novoSaldo <= 0) {
                    db.execSQL("DELETE FROM estoque WHERE id = ?", new Object[]{estoqueId});
                    novoSaldo = 0;
                } else {
                    db.execSQL("UPDATE estoque SET quantidade = ? WHERE id = ?", new Object[]{novoSaldo, estoqueId});
                }
                addMovement(db, "SAIDA", o.getString("produto"), o.getString("nome"), o.getString("lote"),
                        o.getString("endereco"), baixa, novoSaldo);
            }

            boolean ordemConcluida = false;
            if (pedidoItemId > 0) {
                db.execSQL("UPDATE pedido_itens SET status = 'CONCLUIDO' WHERE id = ?", new Object[]{pedidoItemId});
                long restantes = scalarLong(db, "SELECT COUNT(*) FROM pedido_itens WHERE pedido_id = ? AND status != 'CONCLUIDO'",
                        new String[]{String.valueOf(pedidoId)});
                if (restantes == 0) {
                    db.execSQL("UPDATE pedidos SET status = 'CONCLUIDO' WHERE id = ?", new Object[]{pedidoId});
                    ordemConcluida = true;
                }
            }

            db.setTransactionSuccessful();
            JSONObject out = ok();
            out.put("ordem_concluida", ordemConcluida);
            out.put("message", ordemConcluida
                    ? "Separação confirmada! Todos os itens da ordem foram separados (pronta para Checkout)."
                    : "Separação confirmada e estoque atualizado.");
            return out;
        } finally {
            db.endTransaction();
        }
    }

    /* ===================== CHECKOUT FÍSICO DE EXPEDIÇÃO ===================== */

    public JSONObject checkoutStatus(String numeroRaw) throws Exception {
        JSONObject order = getOrder(numeroRaw);
        JSONObject pedido = order.getJSONObject("pedido");
        JSONArray itens = order.getJSONArray("itens");
        SQLiteDatabase db = getReadableDatabase();

        JSONArray confArr = rows(db, "SELECT * FROM checkout_conferencias WHERE pedido_id = ?",
                new String[]{String.valueOf(pedido.getLong("id"))});
        JSONObject conf = confArr.length() > 0 ? confArr.getJSONObject(0) : null;

        JSONArray progresso = new JSONArray();
        for (int i = 0; i < itens.length(); i++) {
            JSONObject it = itens.getJSONObject(i);
            JSONObject p = new JSONObject(it.toString());
            long caixas = 0, unCaixas = 0, avulsas = 0;
            if (conf != null) {
                long confId = conf.getLong("id");
                long itemId = it.getLong("item_id");
                try (Cursor c = db.rawQuery(
                        "SELECT COUNT(id), COALESCE(SUM(unidades), 0) FROM checkout_caixas WHERE conferencia_id = ? AND pedido_item_id = ?",
                        new String[]{String.valueOf(confId), String.valueOf(itemId)})) {
                    if (c.moveToFirst()) {
                        caixas = c.getLong(0);
                        unCaixas = c.getLong(1);
                    }
                }
                avulsas = scalarLong(db,
                        "SELECT COALESCE(quantidade, 0) FROM checkout_avulsas WHERE conferencia_id = ? AND pedido_item_id = ?",
                        new String[]{String.valueOf(confId), String.valueOf(itemId)});
            }
            long confirmado = unCaixas + avulsas;
            p.put("caixas", caixas);
            p.put("unidades_caixa", unCaixas);
            p.put("avulsas", avulsas);
            p.put("confirmado", confirmado);
            p.put("restante", it.getLong("quantidade") - confirmado);
            progresso.put(p);
        }

        JSONObject out = ok();
        out.put("pedido", pedido);
        out.put("itens", itens);
        out.put("conferencia", conf == null ? JSONObject.NULL : conf);
        out.put("progresso", progresso);
        return out;
    }

    public JSONObject iniciarCheckoutFisico(JSONObject data) throws Exception {
        String numero = data.optString("numero").trim().toUpperCase(Locale.US);
        if (numero.isEmpty()) throw new Exception("Informe o número da ordem.");
        JSONObject order = getOrder(numero);
        JSONObject pedido = order.getJSONObject("pedido");
        String status = pedido.optString("status", "").toUpperCase(Locale.US);
        if ("EXPEDIDO".equals(status) || "CANCELADO".equals(status)) {
            throw new Exception("Esta ordem já foi expedida ou cancelada.");
        }
        if (!"CONCLUIDO".equals(status)) {
            throw new Exception("A ordem precisa estar com a separação concluída antes do checkout.");
        }
        SQLiteDatabase db = getWritableDatabase();
        long pedidoId = pedido.getLong("id");
        long exists = scalarLong(db, "SELECT COUNT(*) FROM checkout_conferencias WHERE pedido_id = ?",
                new String[]{String.valueOf(pedidoId)});
        if (exists == 0) {
            db.execSQL("INSERT INTO checkout_conferencias(pedido_id, status, iniciado_em) VALUES(?, 'EM_CONFERENCIA', ?)",
                    new Object[]{pedidoId, now()});
        }
        return checkoutStatus(numero);
    }

    public JSONObject biparCaixaCheckout(JSONObject data) throws Exception {
        String numero = data.optString("numero").trim().toUpperCase(Locale.US);
        String codigo = data.optString("codigo").trim();
        if (numero.isEmpty() || codigo.isEmpty()) throw new Exception("Informe a ordem e leia o código da caixa.");

        String produtoRef = "";
        String loteRef = "";
        try {
            JSONObject obj = new JSONObject(codigo);
            produtoRef = obj.optString("produto", obj.optString("numero", obj.optString("codigo_barras", ""))).trim();
            loteRef = obj.optString("lote", obj.optString("lot", "")).trim();
        } catch (Exception ignored) {
        }
        if (produtoRef.isEmpty()) {
            String[] parts = codigo.split("[|;#]");
            if (parts.length >= 2) {
                produtoRef = parts[0].trim();
                loteRef = parts[1].trim();
            }
        }
        if (produtoRef.isEmpty() || loteRef.isEmpty()) {
            throw new Exception("O código precisa identificar produto e lote (padrão produto|lote ou QR JSON).");
        }

        JSONObject state = checkoutStatus(numero);
        if (state.isNull("conferencia") || !"EM_CONFERENCIA".equals(state.getJSONObject("conferencia").optString("status"))) {
            throw new Exception("Inicie a conferência física antes de bipar caixas.");
        }
        long confId = state.getJSONObject("conferencia").getLong("id");

        SQLiteDatabase db = getWritableDatabase();
        long matchProdId, matchLoteId;
        int matchQc;
        String matchNum, matchNome;
        try (Cursor c = db.rawQuery(
                "SELECT p.id, p.numero, p.nome, l.id, l.unidades_por_caixa FROM produtos p JOIN lotes l ON l.produto_id = p.id " +
                        "WHERE (UPPER(p.numero) = UPPER(?) OR UPPER(COALESCE(p.codigo_barras,'')) = UPPER(?)) AND UPPER(l.lote) = UPPER(?)",
                new String[]{produtoRef, produtoRef, loteRef})) {
            if (!c.moveToFirst()) throw new Exception("Produto/lote não cadastrado no sistema.");
            matchProdId = c.getLong(0);
            matchNum = c.getString(1);
            matchNome = c.getString(2);
            matchLoteId = c.getLong(3);
            matchQc = c.getInt(4);
        }

        JSONArray progresso = state.getJSONArray("progresso");
        JSONObject targetProg = null;
        for (int i = 0; i < progresso.length(); i++) {
            JSONObject p = progresso.getJSONObject(i);
            if (p.getLong("produto_id") == matchProdId) {
                targetProg = p;
                break;
            }
        }
        if (targetProg == null) {
            throw new Exception("Produto fora desta ordem: " + matchNum + " - " + matchNome + ".");
        }
        long confirmado = targetProg.getLong("confirmado");
        long solicitado = targetProg.getLong("quantidade");
        if (confirmado + matchQc > solicitado) {
            throw new Exception("Esta caixa (" + matchQc + " un.) excede o solicitado (" + solicitado +
                    " un.; já conferido: " + confirmado + " un.).");
        }

        db.execSQL("INSERT INTO checkout_caixas(conferencia_id, pedido_item_id, produto_id, lote_id, codigo_lido, unidades, lido_em) " +
                        "VALUES(?, ?, ?, ?, ?, ?, ?)",
                new Object[]{confId, targetProg.getLong("item_id"), matchProdId, matchLoteId, codigo, matchQc, now()});
        return checkoutStatus(numero);
    }

    public JSONObject registrarAvulsasCheckout(JSONObject data) throws Exception {
        String numero = data.optString("numero").trim().toUpperCase(Locale.US);
        long itemId = data.optLong("item_id", 0);
        int quantidade = data.optInt("quantidade", -1);
        if (numero.isEmpty() || itemId <= 0 || quantidade < 0) {
            throw new Exception("Informe item e quantidade avulsa válidos.");
        }
        JSONObject state = checkoutStatus(numero);
        if (state.isNull("conferencia") || !"EM_CONFERENCIA".equals(state.getJSONObject("conferencia").optString("status"))) {
            throw new Exception("Inicie a conferência física primeiro.");
        }
        long confId = state.getJSONObject("conferencia").getLong("id");
        JSONArray progresso = state.getJSONArray("progresso");
        JSONObject target = null;
        for (int i = 0; i < progresso.length(); i++) {
            if (progresso.getJSONObject(i).getLong("item_id") == itemId) {
                target = progresso.getJSONObject(i);
                break;
            }
        }
        if (target == null) throw new Exception("Item não pertence a esta ordem.");
        if (target.getLong("unidades_caixa") + quantidade > target.getLong("quantidade")) {
            throw new Exception("Unidades avulsas ultrapassam a quantidade solicitada.");
        }
        SQLiteDatabase db = getWritableDatabase();
        db.execSQL("INSERT INTO checkout_avulsas(conferencia_id, pedido_item_id, quantidade, atualizado_em) VALUES(?, ?, ?, ?) " +
                        "ON CONFLICT(conferencia_id, pedido_item_id) DO UPDATE SET quantidade = excluded.quantidade, atualizado_em = excluded.atualizado_em",
                new Object[]{confId, itemId, quantidade, now()});
        return checkoutStatus(numero);
    }

    public JSONObject finalizarCheckoutFisico(JSONObject data) throws Exception {
        String numero = data.optString("numero").trim().toUpperCase(Locale.US);
        if (numero.isEmpty()) throw new Exception("Informe a ordem.");
        JSONObject state = checkoutStatus(numero);
        if (state.isNull("conferencia") || !"EM_CONFERENCIA".equals(state.getJSONObject("conferencia").optString("status"))) {
            throw new Exception("Não há conferência física em andamento para esta ordem.");
        }
        JSONArray progresso = state.getJSONArray("progresso");
        StringBuilder faltas = new StringBuilder();
        for (int i = 0; i < progresso.length(); i++) {
            JSONObject p = progresso.getJSONObject(i);
            long diff = p.getLong("quantidade") - p.getLong("confirmado");
            if (diff != 0) {
                if (faltas.length() > 0) faltas.append("; ");
                faltas.append(p.getString("produto_numero")).append(" (falta ").append(diff).append(" un.)");
            }
        }
        if (faltas.length() > 0) {
            throw new Exception("Conferência incompleta: " + faltas + ".");
        }

        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            long pedidoId = state.getJSONObject("pedido").getLong("id");
            long confId = state.getJSONObject("conferencia").getLong("id");
            db.execSQL("UPDATE pedidos SET status = 'EXPEDIDO' WHERE id = ?", new Object[]{pedidoId});
            db.execSQL("UPDATE checkout_conferencias SET status = 'CONCLUIDO', finalizado_em = ? WHERE id = ?",
                    new Object[]{now(), confId});
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
        JSONObject out = ok();
        out.put("message", "Checkout concluído! Ordem " + numero + " marcada como EXPEDIDA (sem baixa duplicada).");
        return out;
    }

    /* ===================== INVENTÁRIO FÍSICO ===================== */

    public JSONObject countInventory(JSONObject data) throws Exception {
        String numero = data.optString("numero").trim();
        String lote = data.optString("lote").trim();
        String endereco = data.optString("endereco").trim().toUpperCase(Locale.US);
        if (!data.has("quantidade_contada")) throw new Exception("Informe a quantidade contada.");
        int contada = data.optInt("quantidade_contada", -1);

        if (numero.isEmpty() || lote.isEmpty() || endereco.isEmpty() || contada < 0) {
            throw new Exception("Informe produto, lote, endereço e uma contagem inteira >= 0.");
        }

        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            long loteId;
            String prodNumero, prodNome, loteReal;
            try (Cursor c = db.rawQuery(
                    "SELECT l.id, p.numero, p.nome, l.lote FROM lotes l JOIN produtos p ON p.id = l.produto_id " +
                            "WHERE (UPPER(p.numero) = UPPER(?) OR UPPER(COALESCE(p.codigo_barras,'')) = UPPER(?)) AND UPPER(l.lote) = UPPER(?)",
                    new String[]{numero, numero, lote})) {
                if (!c.moveToFirst()) throw new Exception("Produto/lote não encontrado.");
                loteId = c.getLong(0);
                prodNumero = c.getString(1);
                prodNome = c.getString(2);
                loteReal = c.getString(3);
            }
            long enderecoId = addressId(db, endereco);
            if (enderecoId < 0) throw new Exception("Endereço " + endereco + " não cadastrado.");

            long anterior = scalarLong(db,
                    "SELECT COALESCE(quantidade, 0) FROM estoque WHERE lote_id = ? AND endereco_id = ?",
                    new String[]{String.valueOf(loteId), String.valueOf(enderecoId)});
            long diferenca = contada - anterior;

            if (diferenca == 0) {
                db.setTransactionSuccessful();
                JSONObject out = ok();
                out.put("saldo_anterior", anterior);
                out.put("saldo", contada);
                out.put("diferenca", 0);
                out.put("message", "Inventário conferido: saldo físico coincide com o sistema (" + contada + " un.).");
                return out;
            }

            if (diferenca > 0) {
                long cap = scalarLong(db, "SELECT capacidade_maxima FROM enderecos WHERE id = ?",
                        new String[]{String.valueOf(enderecoId)});
                long occ = scalarLong(db, "SELECT COALESCE(SUM(quantidade), 0) FROM estoque WHERE endereco_id = ?",
                        new String[]{String.valueOf(enderecoId)});
                if (occ + diferenca > cap) {
                    throw new Exception("Ajuste excede a capacidade máxima do endereço " + endereco + " (" + cap + " un.).");
                }
            }

            if (contada == 0) {
                db.execSQL("DELETE FROM estoque WHERE lote_id = ? AND endereco_id = ?", new Object[]{loteId, enderecoId});
            } else {
                db.execSQL("INSERT OR IGNORE INTO estoque(lote_id, endereco_id, quantidade) VALUES(?, ?, 0)",
                        new Object[]{loteId, enderecoId});
                db.execSQL("UPDATE estoque SET quantidade = ? WHERE lote_id = ? AND endereco_id = ?",
                        new Object[]{contada, loteId, enderecoId});
            }

            addMovement(db, diferenca > 0 ? "AJUSTE_INVENTARIO_ENTRADA" : "AJUSTE_INVENTARIO_SAIDA",
                    prodNumero, prodNome, loteReal, endereco, diferenca, contada);
            db.setTransactionSuccessful();

            JSONObject out = ok();
            out.put("saldo_anterior", anterior);
            out.put("saldo", contada);
            out.put("diferenca", diferenca);
            out.put("message", "Ajuste registrado (" + (diferenca > 0 ? "+" : "") + diferenca +
                    " un.). Saldo atualizado de " + anterior + " para " + contada + " un.");
            return out;
        } finally {
            db.endTransaction();
        }
    }

    /* ===================== ALERTAS OPERACIONAIS ===================== */

    public JSONObject listOperationalAlerts(int alertDays) throws Exception {
        int daysWindow = alertDays > 0 ? alertDays : 30;
        SQLiteDatabase db = getReadableDatabase();
        JSONArray alerts = new JSONArray();

        // 1. Lotes vencidos ou próximos do vencimento com saldo > 0
        JSONArray lots = rows(db,
                "SELECT p.numero, p.nome, l.lote, l.vencimento, COALESCE(SUM(e.quantidade), 0) AS saldo " +
                        "FROM estoque e JOIN lotes l ON l.id = e.lote_id JOIN produtos p ON p.id = l.produto_id " +
                        "WHERE e.quantidade > 0 GROUP BY l.id " +
                        "ORDER BY substr(l.vencimento, 7, 4) || '-' || substr(l.vencimento, 4, 2) || '-' || substr(l.vencimento, 1, 2)",
                new String[]{});
        for (int i = 0; i < lots.length(); i++) {
            JSONObject l = lots.getJSONObject(i);
            long dias = daysUntil(l.optString("vencimento"));
            if (dias < 0) {
                JSONObject a = new JSONObject();
                a.put("tipo", "VENCIDO");
                a.put("severidade", "CRITICO");
                a.put("produto", l.getString("numero"));
                a.put("nome", l.getString("nome"));
                a.put("lote", l.getString("lote"));
                a.put("vencimento", l.getString("vencimento"));
                a.put("saldo", l.getLong("saldo"));
                a.put("detalhe", "Vencido há " + Math.abs(dias) + " dia(s) · Saldo: " + l.getLong("saldo") + " un.");
                alerts.put(a);
            } else if (dias <= daysWindow) {
                JSONObject a = new JSONObject();
                a.put("tipo", "VENCIMENTO_PROXIMO");
                a.put("severidade", "ATENCAO");
                a.put("produto", l.getString("numero"));
                a.put("nome", l.getString("nome"));
                a.put("lote", l.getString("lote"));
                a.put("vencimento", l.getString("vencimento"));
                a.put("saldo", l.getLong("saldo"));
                a.put("detalhe", (dias == 0 ? "Vence hoje" : "Vence em " + dias + " dia(s)") +
                        " (" + l.getString("vencimento") + ") · Saldo: " + l.getLong("saldo") + " un.");
                alerts.put(a);
            }
        }

        // 2. Estoque mínimo atingido/abaixo
        JSONArray lowStock = rows(db,
                "SELECT p.numero, p.nome, p.estoque_minimo, COALESCE(SUM(e.quantidade), 0) AS saldo_total " +
                        "FROM produtos p LEFT JOIN lotes l ON l.produto_id = p.id LEFT JOIN estoque e ON e.lote_id = l.id " +
                        "GROUP BY p.id HAVING p.estoque_minimo > 0 AND COALESCE(SUM(e.quantidade), 0) <= p.estoque_minimo " +
                        "ORDER BY (p.estoque_minimo - COALESCE(SUM(e.quantidade), 0)) DESC, p.numero",
                new String[]{});
        for (int i = 0; i < lowStock.length(); i++) {
            JSONObject s = lowStock.getJSONObject(i);
            JSONObject a = new JSONObject();
            a.put("tipo", "ESTOQUE_MINIMO");
            a.put("severidade", s.getLong("saldo_total") == 0 ? "CRITICO" : "ATENCAO");
            a.put("produto", s.getString("numero"));
            a.put("nome", s.getString("nome"));
            a.put("lote", "Geral");
            a.put("saldo", s.getLong("saldo_total"));
            a.put("estoque_minimo", s.getLong("estoque_minimo"));
            a.put("detalhe", "Saldo atual: " + s.getLong("saldo_total") + " un. · Mínimo configurado: " + s.getLong("estoque_minimo") + " un.");
            alerts.put(a);
        }

        JSONObject out = ok();
        out.put("itens", alerts);
        return out;
    }

    /* ===================== MOVIMENTAÇÕES / AUDITORIA ===================== */

    public JSONObject listMovements(String filtro, String tipoFiltro) throws Exception {
        String sql = "SELECT id, tipo, produto_numero, produto_nome, lote, endereco, quantidade, saldo_apos, data_hora FROM movimentacoes WHERE 1=1 ";
        List<String> args = new ArrayList<>();
        if (filtro != null && !filtro.trim().isEmpty()) {
            String exact = filtro.trim();
            String like = "%" + exact + "%";
            sql += "AND (produto_numero LIKE ? OR produto_nome LIKE ? OR lote LIKE ? OR endereco LIKE ? " +
                    "OR produto_numero IN (SELECT numero FROM produtos WHERE codigo_barras = ?)) ";
            args.add(like);
            args.add(like);
            args.add(like);
            args.add(like);
            args.add(exact);
        }
        if (tipoFiltro != null && !tipoFiltro.trim().isEmpty() && !"TODOS".equalsIgnoreCase(tipoFiltro.trim())) {
            String tf = tipoFiltro.trim().toUpperCase(Locale.US);
            if ("TRANSFERENCIA".equals(tf)) {
                sql += "AND tipo IN ('SAIDA_TRANSFERENCIA', 'ENTRADA_TRANSFERENCIA') ";
            } else if ("INVENTARIO".equals(tf)) {
                sql += "AND tipo IN ('AJUSTE_INVENTARIO_ENTRADA', 'AJUSTE_INVENTARIO_SAIDA') ";
            } else {
                sql += "AND tipo = ? ";
                args.add(tf);
            }
        }
        sql += "ORDER BY id DESC LIMIT 200";
        JSONObject out = ok();
        out.put("itens", rows(getReadableDatabase(), sql, args.toArray(new String[0])));
        return out;
    }

    /* ===================== BACKUP LOCAL & EXPORTAÇÃO CSV ===================== */

    private static final String[] BACKUP_TABLES = {
            "produtos", "lotes", "enderecos", "estoque", "movimentacoes",
            "tarefas_movimentacao", "pedidos", "pedido_itens",
            "checkout_conferencias", "checkout_caixas", "checkout_avulsas"
    };

    public String exportBackupJson() throws Exception {
        SQLiteDatabase db = getReadableDatabase();
        JSONObject root = new JSONObject();
        root.put("app", "MyStock WMS Standalone");
        root.put("schema_version", DB_VERSION);
        root.put("exported_at", now());
        JSONObject tables = new JSONObject();
        for (String table : BACKUP_TABLES) {
            tables.put(table, rows(db, "SELECT * FROM " + table, new String[]{}));
        }
        root.put("tables", tables);
        return root.toString(2);
    }

    public JSONObject importBackupJson(String jsonText) throws Exception {
        if (jsonText == null || jsonText.trim().isEmpty()) throw new Exception("Arquivo de backup vazio.");
        JSONObject root = new JSONObject(jsonText);
        JSONObject tables = root.optJSONObject("tables");
        if (tables == null) throw new Exception("Formato de backup inválido (seção 'tables' ausente).");

        SQLiteDatabase db = getWritableDatabase();
        db.setForeignKeyConstraintsEnabled(false);
        db.beginTransaction();
        try {
            for (int i = BACKUP_TABLES.length - 1; i >= 0; i--) {
                db.execSQL("DELETE FROM " + BACKUP_TABLES[i]);
            }
            int totalRecords = 0;
            for (String table : BACKUP_TABLES) {
                JSONArray arr = tables.optJSONArray(table);
                if (arr == null) continue;
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject row = arr.getJSONObject(i);
                    JSONArray names = row.names();
                    if (names == null || names.length() == 0) continue;
                    StringBuilder cols = new StringBuilder();
                    StringBuilder qs = new StringBuilder();
                    Object[] vals = new Object[names.length()];
                    for (int c = 0; c < names.length(); c++) {
                        String col = names.getString(c);
                        if (c > 0) { cols.append(","); qs.append(","); }
                        cols.append(col);
                        qs.append("?");
                        vals[c] = row.isNull(col) ? null : row.get(col);
                    }
                    db.execSQL("INSERT INTO " + table + "(" + cols + ") VALUES(" + qs + ")", vals);
                    totalRecords++;
                }
            }
            db.setTransactionSuccessful();
            JSONObject out = ok();
            out.put("registros", totalRecords);
            out.put("message", "Backup restaurado com sucesso (" + totalRecords + " registros importados).");
            return out;
        } finally {
            db.endTransaction();
            db.setForeignKeyConstraintsEnabled(true);
        }
    }

    private String csvCell(String v) {
        if (v == null) return "";
        String s = v.replace("\"", "\"\"");
        if (s.contains(";") || s.contains("\"") || s.contains("\n")) {
            return "\"" + s + "\"";
        }
        return s;
    }

    public String exportStockCsv() throws Exception {
        JSONArray itens = listStock("").getJSONArray("itens");
        StringBuilder sb = new StringBuilder();
        sb.append("\uFEFF");
        sb.append("Codigo;CodigoBarras;Produto;Lote;Endereco;Quantidade;UnidadesPorCaixa;CaixasEquivalentes;Fabricacao;Vencimento;EstoqueMinimo\n");
        for (int i = 0; i < itens.length(); i++) {
            JSONObject it = itens.getJSONObject(i);
            long qty = it.optLong("quantidade", 0);
            long qc = Math.max(1, it.optLong("unidades_por_caixa", 1));
            String caixas = String.format(Locale.US, "%.2f", (double) qty / qc).replace('.', ',');
            sb.append(csvCell(it.optString("numero"))).append(";")
                    .append(csvCell(it.isNull("codigo_barras") ? "" : it.optString("codigo_barras"))).append(";")
                    .append(csvCell(it.optString("nome"))).append(";")
                    .append(csvCell(it.optString("lote"))).append(";")
                    .append(csvCell(it.optString("endereco"))).append(";")
                    .append(qty).append(";")
                    .append(qc).append(";")
                    .append(caixas).append(";")
                    .append(csvCell(it.optString("fabricacao"))).append(";")
                    .append(csvCell(it.optString("vencimento"))).append(";")
                    .append(it.optLong("estoque_minimo", 0)).append("\n");
        }
        return sb.toString();
    }

    public JSONObject seedDemoData(String operador) throws Exception {
        SQLiteDatabase db = getWritableDatabase();
        long countProd = scalarLong(db, "SELECT COUNT(*) FROM produtos", null);
        long countEnd = scalarLong(db, "SELECT COUNT(*) FROM enderecos", null);
        if (countProd > 0 || countEnd > 0) {
            throw new Exception("A base já contém dados. Limpe a base primeiro se quiser carregar o ambiente de demonstração.");
        }

        // Endereços
        String[][] ends = {
                {"A01-R01-N01", "5000"}, {"A01-R01-N02", "5000"}, {"A01-R02-N01", "3000"},
                {"A02-R01-N01", "4000"}, {"B01-R01-N01", "2500"}, {"B01-R01-N02", "2500"}
        };
        for (String[] e : ends) {
            JSONObject o = new JSONObject();
            o.put("codigo", e[0]);
            o.put("capacidade_maxima", Integer.parseInt(e[1]));
            saveAddress(o);
        }

        Calendar cal = Calendar.getInstance();
        SimpleDateFormat fmt = new SimpleDateFormat("dd/MM/yyyy", Locale.US);
        String fab = "10/01/2026";
        cal.add(Calendar.DAY_OF_YEAR, 18);
        String vencProx = fmt.format(cal.getTime());
        cal = Calendar.getInstance();
        cal.add(Calendar.DAY_OF_YEAR, 180);
        String vencOk1 = fmt.format(cal.getTime());
        cal = Calendar.getInstance();
        cal.add(Calendar.DAY_OF_YEAR, 320);
        String vencOk2 = fmt.format(cal.getTime());

        Object[][] prods = {
                {"3000281", "7891000300281", "Amoxicilina 500mg cx/60", "LT-2601A", 60, 600, fab, vencProx, "A01-R01-N01", 1800},
                {"3000281", "7891000300281", "Amoxicilina 500mg cx/60", "LT-2604B", 60, 600, fab, vencOk1, "A01-R01-N02", 2400},
                {"3000412", "7891000300412", "Dipirona Sódica 1g cx/50", "LT-2602C", 50, 500, fab, vencOk1, "A01-R02-N01", 1500},
                {"3000550", "7891000300550", "Soro Fisiológico 500ml cx/24", "LT-2603D", 24, 1000, fab, vencOk2, "A02-R01-N01", 720},
                {"3000890", "7891000300890", "Luva Cirúrgica Estéril M cx/100", "LT-2605E", 100, 400, fab, vencOk2, "B01-R01-N01", 2000}
        };
        for (Object[] p : prods) {
            JSONObject o = new JSONObject();
            o.put("numero", p[0]);
            o.put("codigo_barras", p[1]);
            o.put("nome", p[2]);
            o.put("lote", p[3]);
            o.put("unidades_por_caixa", p[4]);
            o.put("estoque_minimo", p[5]);
            o.put("fabricacao", p[6]);
            o.put("vencimento", p[7]);
            o.put("endereco", p[8]);
            o.put("quantidade_entrada", p[9]);
            saveProduct(o);
        }

        // Criar 1 ordem de exemplo
        long p1 = productId(db, "3000281");
        long p2 = productId(db, "3000412");
        JSONObject ord = new JSONObject();
        ord.put("cliente", "Hospital Santa Clara · Unidade Central");
        JSONArray its = new JSONArray();
        its.put(new JSONObject().put("produto_id", p1).put("quantidade", 300));
        its.put(new JSONObject().put("produto_id", p2).put("quantidade", 200));
        ord.put("itens", its);
        createOrder(ord, operador);

        // Criar 1 tarefa de movimentação
        JSONObject mv = new JSONObject();
        mv.put("numero", "3000890");
        mv.put("lote", "LT-2605E");
        mv.put("origem", "B01-R01-N01");
        mv.put("destino", "B01-R01-N02");
        mv.put("quantidade", 500);
        createMoveTask(mv, operador);

        JSONObject out = ok();
        out.put("message", "Ambiente de demonstração carregado com endereços, produtos, alertas e 1 ordem.");
        return out;
    }

    public JSONObject clearAllData() throws Exception {
        SQLiteDatabase db = getWritableDatabase();
        db.setForeignKeyConstraintsEnabled(false);
        db.beginTransaction();
        try {
            for (int i = BACKUP_TABLES.length - 1; i >= 0; i--) {
                db.execSQL("DELETE FROM " + BACKUP_TABLES[i]);
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
            db.setForeignKeyConstraintsEnabled(true);
        }
        JSONObject out = ok();
        out.put("message", "Todos os dados locais foram apagados.");
        return out;
    }
}
