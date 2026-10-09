package com.mystock.app;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class MyStockDbHelper extends SQLiteOpenHelper {
    private static final String DB_NAME = "mystock.db";
    private static final int DB_VERSION = 1;

    public MyStockDbHelper(Context context) {
        super(context, DB_NAME, null, DB_VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE IF NOT EXISTS produtos (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT," +
                "numero TEXT NOT NULL UNIQUE," +
                "codigo_barras TEXT," +
                "nome TEXT NOT NULL)");
        db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS idx_produtos_codigo_barras " +
                "ON produtos(codigo_barras) WHERE codigo_barras IS NOT NULL AND codigo_barras != ''");
        db.execSQL("CREATE TABLE IF NOT EXISTS lotes (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT," +
                "produto_id INTEGER NOT NULL," +
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
                "lote_id INTEGER NOT NULL," +
                "endereco_id INTEGER NOT NULL," +
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
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        onCreate(db);
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
                return new SimpleDateFormat("dd/MM/yyyy", Locale.US).format(date);
            } catch (ParseException ignored) {
            }
        }
        throw new Exception("Use datas no formato DD/MM/AAAA ou DD/MM/AA.");
    }

    private String now() {
        return new SimpleDateFormat("dd/MM/yyyy HH:mm:ss", Locale.US).format(new Date());
    }

    private long productId(SQLiteDatabase db, String numeroOrCode) {
        try (Cursor c = db.rawQuery(
                "SELECT id FROM produtos WHERE numero = ? OR codigo_barras = ?",
                new String[]{numeroOrCode, numeroOrCode})) {
            return c.moveToFirst() ? c.getLong(0) : -1;
        }
    }

    private long addressId(SQLiteDatabase db, String codigo) {
        try (Cursor c = db.rawQuery("SELECT id FROM enderecos WHERE codigo = ?", new String[]{codigo})) {
            return c.moveToFirst() ? c.getLong(0) : -1;
        }
    }

    private JSONObject rowToJson(Cursor c) throws Exception {
        JSONObject obj = new JSONObject();
        for (int i = 0; i < c.getColumnCount(); i++) {
            int type = c.getType(i);
            String name = c.getColumnName(i);
            if (type == Cursor.FIELD_TYPE_INTEGER) obj.put(name, c.getLong(i));
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

    public JSONObject saveAddress(JSONObject data) throws Exception {
        String codigo = data.optString("codigo").trim().toUpperCase(Locale.US);
        int capacidade = data.optInt("capacidade_maxima", 0);
        if (codigo.isEmpty()) throw new Exception("Informe o endereço.");
        if (capacidade <= 0) throw new Exception("O limite máximo precisa ser maior que zero.");

        SQLiteDatabase db = getWritableDatabase();
        long ocupado = 0;
        try (Cursor c = db.rawQuery(
                "SELECT COALESCE(SUM(e.quantidade), 0) FROM enderecos en " +
                        "LEFT JOIN estoque e ON e.endereco_id = en.id WHERE en.codigo = ?",
                new String[]{codigo})) {
            if (c.moveToFirst()) ocupado = c.getLong(0);
        }
        if (capacidade < ocupado) {
            throw new Exception("Esse endereço já possui " + ocupado +
                    " unidade(s). O novo limite não pode ser menor que a ocupação atual.");
        }
        db.execSQL("INSERT OR IGNORE INTO enderecos(codigo, capacidade_maxima) VALUES(?, ?)",
                new Object[]{codigo, capacidade});
        db.execSQL("UPDATE enderecos SET capacidade_maxima = ? WHERE codigo = ?",
                new Object[]{capacidade, codigo});
        JSONObject out = ok();
        out.put("message", "Endereço salvo com sucesso.");
        return out;
    }

    public JSONObject listAddresses(boolean onlyAvailable) throws Exception {
        String sql = "SELECT en.codigo, en.capacidade_maxima, " +
                "COALESCE(SUM(e.quantidade), 0) AS ocupado, " +
                "en.capacidade_maxima - COALESCE(SUM(e.quantidade), 0) AS disponivel " +
                "FROM enderecos en LEFT JOIN estoque e ON e.endereco_id = en.id " +
                "GROUP BY en.id, en.codigo, en.capacidade_maxima ";
        if (onlyAvailable) sql += "HAVING disponivel > 0 ";
        sql += "ORDER BY en.codigo";
        JSONObject out = ok();
        out.put("itens", rows(getReadableDatabase(), sql, new String[]{}));
        return out;
    }

    public JSONObject saveProduct(JSONObject data) throws Exception {
        String numero = data.optString("numero").trim();
        String codigoBarras = data.optString("codigo_barras").trim();
        String nome = data.optString("nome").trim();
        String lote = data.optString("lote").trim();
        int qc = data.optInt("unidades_por_caixa", 0);
        String fabricacao = normalizeDate(data.optString("fabricacao"));
        String vencimento = normalizeDate(data.optString("vencimento"));
        String endereco = data.optString("endereco").trim().toUpperCase(Locale.US);
        int quantidadeEntrada = data.optInt("quantidade_entrada", 0);

        if (numero.isEmpty() || nome.isEmpty() || lote.isEmpty()) throw new Exception("Informe número, nome e lote.");
        if (qc <= 0) throw new Exception("Unidades por caixa precisa ser maior que zero.");
        if (quantidadeEntrada > 0 && endereco.isEmpty()) throw new Exception("Selecione um endereço para registrar a quantidade inicial.");
        if (!endereco.isEmpty() && quantidadeEntrada <= 0) throw new Exception("Informe a quantidade inicial para usar o endereço selecionado.");

        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            db.execSQL("INSERT OR IGNORE INTO produtos(numero, codigo_barras, nome) VALUES(?, ?, ?)",
                    new Object[]{numero, codigoBarras.isEmpty() ? null : codigoBarras, nome});
            db.execSQL("UPDATE produtos SET codigo_barras = ?, nome = ? WHERE numero = ?",
                    new Object[]{codigoBarras.isEmpty() ? null : codigoBarras, nome, numero});
            long pid = productId(db, numero);
            db.execSQL("INSERT OR IGNORE INTO lotes(produto_id, lote, unidades_por_caixa, fabricacao, vencimento) VALUES(?, ?, ?, ?, ?)",
                    new Object[]{pid, lote, qc, fabricacao, vencimento});
            db.execSQL("UPDATE lotes SET unidades_por_caixa = ?, fabricacao = ?, vencimento = ? WHERE produto_id = ? AND lote = ?",
                    new Object[]{qc, fabricacao, vencimento, pid, lote});
            db.setTransactionSuccessful();
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
            out.put("message", "Produto salvo e endereçado com sucesso.");
            return out;
        }
        JSONObject out = ok();
        out.put("message", "Produto salvo com sucesso.");
        return out;
    }

    public JSONObject registerEntry(JSONObject data) throws Exception {
        String numero = data.optString("numero").trim();
        String lote = data.optString("lote").trim();
        String endereco = data.optString("endereco").trim().toUpperCase(Locale.US);
        int quantidade = data.optInt("quantidade", 0);
        if (numero.isEmpty() || lote.isEmpty() || endereco.isEmpty()) throw new Exception("Informe produto, lote e endereço.");
        if (quantidade <= 0) throw new Exception("Quantidade de entrada precisa ser maior que zero.");

        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            long loteId;
            String produtoNumero;
            String produtoNome;
            try (Cursor c = db.rawQuery(
                    "SELECT l.id, p.numero, p.nome FROM lotes l JOIN produtos p ON p.id = l.produto_id " +
                            "WHERE (p.numero = ? OR p.codigo_barras = ?) AND l.lote = ?",
                    new String[]{numero, numero, lote})) {
                if (!c.moveToFirst()) throw new Exception("Produto não encontrado. Cadastre primeiro.");
                loteId = c.getLong(0);
                produtoNumero = c.getString(1);
                produtoNome = c.getString(2);
            }
            long enderecoId = addressId(db, endereco);
            if (enderecoId < 0) throw new Exception("Endereço não cadastrado. Cadastre o endereço e sua capacidade primeiro.");

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
                        ". Disponível: " + disponivel + " unidade(s). Entrada: " + quantidade + " unidade(s).");
            }

            db.execSQL("INSERT OR IGNORE INTO estoque(lote_id, endereco_id, quantidade) VALUES(?, ?, 0)",
                    new Object[]{loteId, enderecoId});
            db.execSQL("UPDATE estoque SET quantidade = quantidade + ? WHERE lote_id = ? AND endereco_id = ?",
                    new Object[]{quantidade, loteId, enderecoId});
            long saldo;
            try (Cursor c = db.rawQuery("SELECT quantidade FROM estoque WHERE lote_id = ? AND endereco_id = ?",
                    new String[]{String.valueOf(loteId), String.valueOf(enderecoId)})) {
                c.moveToFirst();
                saldo = c.getLong(0);
            }
            addMovement(db, "ENTRADA", produtoNumero, produtoNome, lote, endereco, quantidade, saldo);
            db.setTransactionSuccessful();
            JSONObject out = ok();
            out.put("message", "Entrada registrada. Saldo atual: " + saldo + " unidade(s).");
            return out;
        } finally {
            db.endTransaction();
        }
    }

    private void addMovement(SQLiteDatabase db, String tipo, String produtoNumero, String produtoNome,
                             String lote, String endereco, long quantidade, long saldoApos) {
        db.execSQL("INSERT INTO movimentacoes(tipo, produto_numero, produto_nome, lote, endereco, quantidade, saldo_apos, data_hora) " +
                        "VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
                new Object[]{tipo, produtoNumero, produtoNome, lote, endereco, quantidade, saldoApos, now()});
    }

    public JSONObject listStock(String numero) throws Exception {
        String sql = "SELECT p.numero, p.codigo_barras, p.nome, l.lote, l.unidades_por_caixa, l.fabricacao, l.vencimento, " +
                "en.codigo AS endereco, e.quantidade FROM estoque e " +
                "JOIN lotes l ON l.id = e.lote_id JOIN produtos p ON p.id = l.produto_id " +
                "JOIN enderecos en ON en.id = e.endereco_id ";
        String[] args = new String[]{};
        if (numero != null && !numero.trim().isEmpty()) {
            sql += "WHERE p.numero = ? OR p.codigo_barras = ? ";
            args = new String[]{numero.trim(), numero.trim()};
        }
        sql += "ORDER BY p.numero, substr(l.vencimento, 7, 4) || '-' || substr(l.vencimento, 4, 2) || '-' || substr(l.vencimento, 1, 2), en.codigo";
        JSONObject out = ok();
        out.put("itens", rows(getReadableDatabase(), sql, args));
        return out;
    }

    public JSONObject listLots(String produto) throws Exception {
        String filtro = produto == null ? "" : produto.trim();
        if (filtro.isEmpty()) throw new Exception("Informe o produto.");
        JSONObject out = ok();
        out.put("itens", rows(getReadableDatabase(),
                "SELECT p.numero, p.codigo_barras, p.nome, l.lote, l.unidades_por_caixa, l.fabricacao, l.vencimento " +
                        "FROM lotes l JOIN produtos p ON p.id = l.produto_id " +
                        "WHERE p.numero = ? OR p.codigo_barras = ? " +
                        "ORDER BY substr(l.vencimento, 7, 4) || '-' || substr(l.vencimento, 4, 2) || '-' || substr(l.vencimento, 1, 2), l.lote",
                new String[]{filtro, filtro}));
        return out;
    }

    public JSONObject listProducts(String filtro) throws Exception {
        String sql = "SELECT p.numero, p.codigo_barras, p.nome, l.lote, l.unidades_por_caixa, l.fabricacao, l.vencimento, " +
                "COALESCE(SUM(e.quantidade), 0) AS saldo_total FROM produtos p " +
                "JOIN lotes l ON l.produto_id = p.id LEFT JOIN estoque e ON e.lote_id = l.id ";
        String[] args = new String[]{};
        if (filtro != null && !filtro.trim().isEmpty()) {
            sql += "WHERE p.numero = ? OR p.codigo_barras = ? OR p.nome LIKE ? ";
            args = new String[]{filtro.trim(), filtro.trim(), "%" + filtro.trim() + "%"};
        }
        sql += "GROUP BY p.id, p.numero, p.codigo_barras, p.nome, l.id, l.lote, l.unidades_por_caixa, l.fabricacao, l.vencimento " +
                "ORDER BY p.numero, substr(l.vencimento, 7, 4) || '-' || substr(l.vencimento, 4, 2) || '-' || substr(l.vencimento, 1, 2), l.lote";
        JSONObject out = ok();
        out.put("itens", rows(getReadableDatabase(), sql, args));
        return out;
    }

    public JSONObject listMovements(String filtro) throws Exception {
        String sql = "SELECT tipo, produto_numero, produto_nome, lote, endereco, quantidade, saldo_apos, data_hora FROM movimentacoes ";
        String[] args = new String[]{};
        if (filtro != null && !filtro.trim().isEmpty()) {
            sql += "WHERE produto_numero = ? OR produto_numero IN (SELECT numero FROM produtos WHERE codigo_barras = ?) ";
            args = new String[]{filtro.trim(), filtro.trim()};
        }
        sql += "ORDER BY id DESC LIMIT 100";
        JSONObject out = ok();
        out.put("itens", rows(getReadableDatabase(), sql, args));
        return out;
    }

    public JSONObject previewSeparation(JSONObject data) throws Exception {
        String numero = data.optString("numero").trim();
        int quantidadePedida = data.optInt("quantidade", 0);
        if (numero.isEmpty() || quantidadePedida <= 0) throw new Exception("Informe produto e quantidade válida.");

        JSONArray saldos = rows(getReadableDatabase(),
                "SELECT e.id AS estoque_id, p.numero, p.nome, l.lote, l.unidades_por_caixa, l.vencimento, en.codigo AS endereco, e.quantidade " +
                        "FROM estoque e JOIN lotes l ON l.id = e.lote_id JOIN produtos p ON p.id = l.produto_id " +
                        "JOIN enderecos en ON en.id = e.endereco_id " +
                        "WHERE (p.numero = ? OR p.codigo_barras = ?) AND e.quantidade > 0 " +
                        "ORDER BY substr(l.vencimento, 7, 4) || '-' || substr(l.vencimento, 4, 2) || '-' || substr(l.vencimento, 1, 2), en.codigo",
                new String[]{numero, numero});
        if (saldos.length() == 0) throw new Exception("Produto não encontrado em estoque.");

        long total = 0;
        for (int i = 0; i < saldos.length(); i++) total += saldos.getJSONObject(i).getLong("quantidade");
        if (total < quantidadePedida) throw new Exception("Saldo insuficiente. Disponível: " + total + ". Solicitado: " + quantidadePedida + ".");

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
            o.put("quantidade_baixa", retirar);
            o.put("qtd_operador", qtdOperador);
            o.put("unidade_operador", unidadeOperador);
            orientacoes.put(o);
            restante -= retirar;
        }
        JSONObject token = new JSONObject();
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
        for (int i = 0; i < orientacoes.length(); i++) {
            int esperado = orientacoes.getJSONObject(i).getInt("qtd_operador");
            int confirmado = confirmacoes.getJSONObject(i).getInt("quantidade_confirmada");
            if (esperado != confirmado) throw new Exception("Quantidade confirmada diferente da orientação. Estoque não alterado.");
        }

        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            for (int i = 0; i < orientacoes.length(); i++) {
                JSONObject o = orientacoes.getJSONObject(i);
                long estoqueId = o.getLong("estoque_id");
                int baixa = o.getInt("quantidade_baixa");
                long atual;
                try (Cursor c = db.rawQuery("SELECT quantidade FROM estoque WHERE id = ?", new String[]{String.valueOf(estoqueId)})) {
                    if (!c.moveToFirst()) throw new Exception("Estoque não encontrado. Gere a orientação novamente.");
                    atual = c.getLong(0);
                }
                if (atual < baixa) throw new Exception("Saldo mudou e ficou insuficiente. Gere a orientação novamente.");
                long novoSaldo = atual - baixa;
                db.execSQL("UPDATE estoque SET quantidade = ? WHERE id = ?", new Object[]{novoSaldo, estoqueId});
                addMovement(db, "SAIDA", o.getString("produto"), o.getString("nome"), o.getString("lote"),
                        o.getString("endereco"), baixa, novoSaldo);
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
        JSONObject out = ok();
        out.put("message", "Separação confirmada e estoque atualizado.");
        return out;
    }
}
