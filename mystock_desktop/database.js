const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Database = require("better-sqlite3");

class MyStockDatabase {
  constructor(userDataPath) {
    fs.mkdirSync(userDataPath, { recursive: true });
    this.db = new Database(path.join(userDataPath, "mystock.db"));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.createSchema();
    this.migrateLegacyStockSchema();
  }


  authStatus() {
    return this.ok({ setupRequired: this.db.prepare("SELECT COUNT(*) AS total FROM usuarios").get().total === 0 });
  }

  validateUserInput(data, requirePassword = true) {
    const nome=String(data.nome||"").trim(), username=String(data.username||"").trim().toLowerCase(), password=String(data.password||"");
    if(nome.length<2)this.fail("Informe o nome do usuário.");
    if(!/^[a-z0-9._-]{3,40}$/.test(username))this.fail("O usuário deve ter de 3 a 40 caracteres: letras, números, ponto, hífen ou sublinhado.");
    if(requirePassword&&password.length<8)this.fail("A senha precisa ter pelo menos 8 caracteres.");
    if(!requirePassword&&password&&password.length<8)this.fail("A nova senha precisa ter pelo menos 8 caracteres.");
    return {nome,username,password};
  }

  passwordRecord(password) {
    const salt=crypto.randomBytes(16).toString("hex");
    return {salt,hash:crypto.scryptSync(password,salt,64).toString("hex")};
  }

  publicUser(row) {
    let permissoes={};try{permissoes=JSON.parse(row.permissoes_json||"{}");}catch{}
    return {id:row.id,username:row.username,nome:row.nome,role:row.role,permissoes,ativo:Boolean(row.ativo),criado_em:row.criado_em};
  }

  getUserById(id) {
    const row=this.db.prepare("SELECT id,username,nome,role,permissoes_json,ativo,criado_em FROM usuarios WHERE id=?").get(Number(id));
    return row?this.publicUser(row):null;
  }

  createInitialAdmin(data) {
    if(this.db.prepare("SELECT COUNT(*) AS total FROM usuarios").get().total!==0)this.fail("A configuração inicial já foi concluída. Entre com seu usuário.");
    const {nome,username,password}=this.validateUserInput(data,true), record=this.passwordRecord(password);
    this.db.prepare("INSERT INTO usuarios(username,nome,password_salt,password_hash,role,permissoes_json,ativo,criado_em) VALUES(?,?,?,?,?,?,1,?)")
      .run(username,nome,record.salt,record.hash,"admin","{}",this.now());
    return this.ok({message:"Administrador criado. Entre com seu usuário e senha."});
  }

  loginUser(data) {
    const username=String(data.username||"").trim().toLowerCase(), password=String(data.password||"");
    if(!username||!password)this.fail("Informe usuário e senha.");
    const row=this.db.prepare("SELECT * FROM usuarios WHERE username=?").get(username);
    if(!row||!row.ativo)this.fail("Usuário ou senha inválidos, ou conta desativada.");
    const actual=crypto.scryptSync(password,row.password_salt,64), expected=Buffer.from(row.password_hash,"hex");
    if(actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected))this.fail("Usuário ou senha inválidos, ou conta desativada.");
    return this.ok({user:this.publicUser(row)});
  }

  listUsers() {
    return this.ok({itens:this.db.prepare("SELECT id,username,nome,role,permissoes_json,ativo,criado_em FROM usuarios ORDER BY role DESC,nome COLLATE NOCASE").all().map(row=>this.publicUser(row))});
  }

  listAuditOperators() {
    return this.ok({itens:this.db.prepare("SELECT id,nome,username,ativo FROM usuarios WHERE role='operador' ORDER BY nome COLLATE NOCASE").all().map(u=>({...u,ativo:Boolean(u.ativo)}))});
  }

  recordAudit(data = {}) {
    const userId=Number(data.usuario_id)||null;
    const nome=String(data.operador_nome||"Operador").slice(0,100);
    const username=String(data.operador_username||"").slice(0,40);
    const device=String(data.dispositivo||"Android").slice(0,40);
    const ip=String(data.endereco_ip||"").slice(0,80);
    const action=String(data.acao||"").slice(0,80);
    const success=data.sucesso===false?0:1;
    const payload=data.detalhes&&typeof data.detalhes==="object"?data.detalhes:{};
    const safe={};
    const allowed=["numero","codigo_barras","nome","lote","endereco","quantidade","quantidade_entrada","estoque_minimo","produto_id","lote_id","pedido_id","pedido_item_id","cliente","itens","filtro","ativo","capacidade_maxima","quantidade_confirmada","erro"];
    for(const key of allowed) if(payload[key]!==undefined){
      const value=payload[key];
      safe[key]=Array.isArray(value)?value.slice(0,30).map(x=>x&&typeof x==="object"?Object.fromEntries(Object.entries(x).filter(([k])=>["produto_id","quantidade","index","quantidade_confirmada"].includes(k))):x):String(value).slice(0,500);
    }
    this.db.prepare("INSERT INTO auditoria(usuario_id,operador_nome,operador_username,dispositivo,endereco_ip,acao,detalhes,sucesso,data_hora) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(userId,nome,username,device,ip,action,JSON.stringify(safe),success,new Date().toISOString());
    return this.ok();
  }

  listAudit(data = {}) {
    const userId=Number(data.usuario_id)||0;
    if(!userId)this.fail("Selecione um operador para consultar a auditoria.");
    const from=String(data.de||"").trim(), to=String(data.ate||"").trim(), action=String(data.acao||"").trim();
    let sql="SELECT id,operador_nome,operador_username,dispositivo,endereco_ip,acao,detalhes,sucesso,data_hora FROM auditoria WHERE usuario_id=?";
    const params=[userId];
    if(from){sql+=" AND substr(data_hora,1,10)>=?";params.push(from);}
    if(to){sql+=" AND substr(data_hora,1,10)<=?";params.push(to);}
    if(action){sql+=" AND acao=?";params.push(action);}
    sql+=" ORDER BY data_hora DESC,id DESC LIMIT 1000";
    return this.ok({itens:this.rows(sql,params).map(row=>{let detalhes={};try{detalhes=JSON.parse(row.detalhes||"{}");}catch{}return {...row,detalhes,sucesso:Boolean(row.sucesso)};})});
  }

  saveUser(data) {
    const id=Number(data.id)||0, {nome,username,password}=this.validateUserInput(data,!id);
    const allowed=["cadastro","produtos","entrada","enderecos","consulta_estoque","separacao","movimentacoes"];
    const raw=data.permissoes&&typeof data.permissoes==="object"?data.permissoes:{};
    const permissoes=Object.fromEntries(allowed.map(key=>[key,raw[key]===true]));
    if(id){
      const old=this.db.prepare("SELECT id,role FROM usuarios WHERE id=?").get(id);
      if(!old)this.fail("Usuário não encontrado.");
      if(old.role==="admin")this.fail("A conta administradora não pode ser alterada por esta tela.");
      if(password){const rec=this.passwordRecord(password);this.db.prepare("UPDATE usuarios SET username=?,nome=?,password_salt=?,password_hash=?,permissoes_json=? WHERE id=?").run(username,nome,rec.salt,rec.hash,JSON.stringify(permissoes),id);}
      else this.db.prepare("UPDATE usuarios SET username=?,nome=?,permissoes_json=? WHERE id=?").run(username,nome,JSON.stringify(permissoes),id);
      return this.ok({message:"Usuário atualizado."});
    }
    const rec=this.passwordRecord(password);
    this.db.prepare("INSERT INTO usuarios(username,nome,password_salt,password_hash,role,permissoes_json,ativo,criado_em) VALUES(?,?,?,?,?,?,1,?)")
      .run(username,nome,rec.salt,rec.hash,"operador",JSON.stringify(permissoes),this.now());
    return this.ok({message:"Usuário criado."});
  }

  toggleUser(data) {
    const id=Number(data.id), ativo=data.ativo?1:0;
    if(!Number.isInteger(id)||id<=0)this.fail("Usuário inválido.");
    const row=this.db.prepare("SELECT id,role FROM usuarios WHERE id=?").get(id);
    if(!row)this.fail("Usuário não encontrado.");
    if(row.role==="admin")this.fail("A conta administradora não pode ser desativada por esta tela.");
    this.db.prepare("UPDATE usuarios SET ativo=? WHERE id=?").run(ativo,id);
    return this.ok({message:ativo?"Usuário ativado.":"Usuário desativado."});
  }

  close() { this.db.close(); }

  // Safely migrates older desktop databases whose estoque table predates lote_id.
  // The original table is retained as estoque_legacy_backup after a successful migration.
  migrateLegacyStockSchema() {
    const cols = this.rows("PRAGMA table_info(estoque)");
    if (!cols.length || cols.some(col => col.name === "lote_id")) return;

    const backupExists = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'estoque_legacy_backup'"
    ).get();
    if (backupExists) {
      this.fail("O banco possui uma tabela estoque antiga e uma cópia estoque_legacy_backup. Nenhum dado foi apagado. Faça uma cópia do arquivo mystock.db antes de qualquer reparo manual.");
    }

    const legacyRows = this.rows("SELECT * FROM estoque");
    const names = new Set(cols.map(col => col.name));
    const pick = (row, candidates) => {
      for (const key of candidates) if (names.has(key) && row[key] !== null && row[key] !== undefined && String(row[key]).trim() !== "") return row[key];
      return null;
    };

    const migrate = this.db.transaction(() => {
      this.db.exec("ALTER TABLE estoque RENAME TO estoque_legacy_backup");
      this.db.exec(`CREATE TABLE estoque (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lote_id INTEGER NOT NULL REFERENCES lotes(id),
        endereco_id INTEGER NOT NULL REFERENCES enderecos(id),
        quantidade INTEGER NOT NULL DEFAULT 0,
        UNIQUE(lote_id, endereco_id)
      )`);

      for (const row of legacyRows) {
        const productRef = pick(row, ["produto_id", "product_id", "id_produto"]);
        const productNumber = pick(row, ["produto_numero", "numero_produto", "numero", "codigo_produto"]);
        let product = null;
        if (productRef !== null && Number.isFinite(Number(productRef))) {
          product = this.db.prepare("SELECT id, numero FROM produtos WHERE id = ?").get(Number(productRef));
        }
        if (!product && productNumber !== null) {
          product = this.db.prepare("SELECT id, numero FROM produtos WHERE numero = ? OR codigo_barras = ?").get(String(productNumber), String(productNumber));
        }
        if (!product) {
          this.fail("Migração segura interrompida: não foi possível associar uma linha antiga do estoque a um produto. A transação foi desfeita e os dados originais foram preservados.");
        }

        const lotRef = pick(row, ["lote", "codigo_lote", "lote_codigo", "numero_lote"]);
        let lot = null;
        if (lotRef !== null) {
          lot = this.db.prepare("SELECT id FROM lotes WHERE produto_id = ? AND lote = ?").get(product.id, String(lotRef));
          if (!lot && Number.isFinite(Number(lotRef))) {
            lot = this.db.prepare("SELECT id FROM lotes WHERE id = ? AND produto_id = ?").get(Number(lotRef), product.id);
          }
        }
        if (!lot) {
          const lots = this.db.prepare("SELECT id FROM lotes WHERE produto_id = ? ORDER BY id").all(product.id);
          if (lots.length === 1) lot = lots[0];
        }
        if (!lot) {
          this.fail("Migração segura interrompida: não foi possível identificar o lote de um registro antigo. A transação foi desfeita e os dados originais foram preservados.");
        }

        const addressRef = pick(row, ["endereco_id", "address_id", "id_endereco"]);
        const addressCode = pick(row, ["endereco", "codigo_endereco", "endereco_codigo", "codigo"]);
        let address = null;
        if (addressRef !== null && Number.isFinite(Number(addressRef))) {
          address = this.db.prepare("SELECT id FROM enderecos WHERE id = ?").get(Number(addressRef));
        }
        if (!address && addressCode !== null) {
          address = this.db.prepare("SELECT id FROM enderecos WHERE codigo = ?").get(String(addressCode).trim().toUpperCase());
        }
        if (!address) {
          this.fail("Migração segura interrompida: não foi possível associar um registro antigo a um endereço. A transação foi desfeita e os dados originais foram preservados.");
        }

        const quantityValue = pick(row, ["quantidade", "quantity", "saldo", "qtd"]);
        const quantity = Number.parseInt(quantityValue, 10);
        if (!Number.isInteger(quantity) || quantity < 0) {
          this.fail("Migração segura interrompida: quantidade antiga inválida. A transação foi desfeita e os dados originais foram preservados.");
        }
        this.db.prepare(`INSERT INTO estoque(lote_id, endereco_id, quantidade) VALUES (?, ?, ?)
          ON CONFLICT(lote_id, endereco_id) DO UPDATE SET quantidade = quantidade + excluded.quantidade`)
          .run(lot.id, address.id, quantity);
      }
    });

    try {
      migrate();
    } catch (error) {
      if (String(error.message || "").includes("no such column")) {
        this.fail("O banco antigo tem uma estrutura diferente da esperada. Nenhum registro foi removido. Detalhe: " + error.message);
      }
      throw error;
    }
  }

  createSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS produtos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        numero TEXT NOT NULL UNIQUE,
        codigo_barras TEXT,
        nome TEXT NOT NULL,
        estoque_minimo INTEGER NOT NULL DEFAULT 0
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_produtos_codigo_barras
        ON produtos(codigo_barras)
        WHERE codigo_barras IS NOT NULL AND codigo_barras != '';
      CREATE TABLE IF NOT EXISTS lotes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        produto_id INTEGER NOT NULL REFERENCES produtos(id),
        lote TEXT NOT NULL,
        unidades_por_caixa INTEGER NOT NULL,
        fabricacao TEXT NOT NULL,
        vencimento TEXT NOT NULL,
        UNIQUE(produto_id, lote)
      );
      CREATE TABLE IF NOT EXISTS enderecos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        codigo TEXT NOT NULL UNIQUE,
        capacidade_maxima INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS estoque (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lote_id INTEGER NOT NULL REFERENCES lotes(id),
        endereco_id INTEGER NOT NULL REFERENCES enderecos(id),
        quantidade INTEGER NOT NULL DEFAULT 0,
        UNIQUE(lote_id, endereco_id)
      );
      CREATE TABLE IF NOT EXISTS movimentacoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tipo TEXT NOT NULL,
        produto_numero TEXT NOT NULL,
        produto_nome TEXT NOT NULL,
        lote TEXT NOT NULL,
        endereco TEXT NOT NULL,
        quantidade INTEGER NOT NULL,
        saldo_apos INTEGER NOT NULL,
        data_hora TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        nome TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'operador',
        permissoes_json TEXT NOT NULL DEFAULT '{}',
        ativo INTEGER NOT NULL DEFAULT 1,
        criado_em TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pedidos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        numero TEXT NOT NULL UNIQUE,
        cliente TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'PENDENTE',
        criado_em TEXT NOT NULL,
        criado_por TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS pedido_itens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
        produto_id INTEGER NOT NULL REFERENCES produtos(id),
        quantidade INTEGER NOT NULL CHECK(quantidade > 0),
        status TEXT NOT NULL DEFAULT 'PENDENTE',
        UNIQUE(pedido_id, produto_id)
      );
      CREATE TABLE IF NOT EXISTS auditoria (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER,
        operador_nome TEXT NOT NULL,
        operador_username TEXT NOT NULL,
        dispositivo TEXT NOT NULL DEFAULT 'Android',
        endereco_ip TEXT NOT NULL DEFAULT '',
        acao TEXT NOT NULL,
        detalhes TEXT NOT NULL DEFAULT '',
        sucesso INTEGER NOT NULL DEFAULT 1,
        data_hora TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_auditoria_usuario_data ON auditoria(usuario_id, data_hora DESC);
      CREATE INDEX IF NOT EXISTS idx_auditoria_acao_data ON auditoria(acao, data_hora DESC);
    `);
    const productColumns = this.rows("PRAGMA table_info(produtos)");
    if (!productColumns.some(col => col.name === "estoque_minimo")) {
      this.db.exec("ALTER TABLE produtos ADD COLUMN estoque_minimo INTEGER NOT NULL DEFAULT 0");
    }
  }

  ok(extra = {}) { return { ok: true, ...extra }; }
  fail(message) { throw new Error(message); }

  normalizeDate(input) {
    const value = String(input ?? "").trim();
    const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
    if (!match) this.fail("Use datas no formato DD/MM/AAAA ou DD/MM/AA.");
    const day = Number(match[1]);
    const month = Number(match[2]);
    let year = Number(match[3]);
    if (match[3].length === 2) year += year >= 70 ? 1900 : 2000;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
      this.fail("Data inválida. Confira dia, mês e ano.");
    return String(day).padStart(2, "0") + "/" + String(month).padStart(2, "0") + "/" + year;
  }

  now() {
    const d = new Date();
    const pad = n => String(n).padStart(2, "0");
    return pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear() +
      " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }

  rows(sql, params = []) { return this.db.prepare(sql).all(...params); }
  productId(value) {
    const row = this.db.prepare("SELECT id FROM produtos WHERE numero = ? OR codigo_barras = ?").get(value, value);
    return row ? row.id : -1;
  }
  addressId(value) {
    const row = this.db.prepare("SELECT id FROM enderecos WHERE codigo = ?").get(value);
    return row ? row.id : -1;
  }

  addMovement(tipo, numero, nome, lote, endereco, quantidade, saldo) {
    this.db.prepare(`INSERT INTO movimentacoes
      (tipo, produto_numero, produto_nome, lote, endereco, quantidade, saldo_apos, data_hora)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(tipo, numero, nome, lote, endereco, quantidade, saldo, this.now());
  }

  saveAddress(data) {
    const codigo = String(data.codigo || "").trim().toUpperCase();
    const capacidade = Number.parseInt(data.capacidade_maxima, 10) || 0;
    if (!codigo) this.fail("Informe o endereço.");
    if (capacidade <= 0) this.fail("O limite máximo precisa ser maior que zero.");
    const row = this.db.prepare(`SELECT COALESCE(SUM(e.quantidade), 0) AS ocupado
      FROM enderecos en LEFT JOIN estoque e ON e.endereco_id = en.id WHERE en.codigo = ?`).get(codigo);
    if (capacidade < row.ocupado)
      this.fail("Esse endereço já possui " + row.ocupado + " unidade(s). O novo limite não pode ser menor que a ocupação atual.");
    this.db.prepare("INSERT OR IGNORE INTO enderecos(codigo, capacidade_maxima) VALUES (?, ?)").run(codigo, capacidade);
    this.db.prepare("UPDATE enderecos SET capacidade_maxima = ? WHERE codigo = ?").run(capacidade, codigo);
    return this.ok({ message: "Endereço salvo com sucesso." });
  }

  listAddresses(onlyAvailable) {
    let sql = `SELECT en.codigo, en.capacidade_maxima,
      COALESCE(SUM(e.quantidade), 0) AS ocupado,
      en.capacidade_maxima - COALESCE(SUM(e.quantidade), 0) AS disponivel
      FROM enderecos en LEFT JOIN estoque e ON e.endereco_id = en.id
      GROUP BY en.id, en.codigo, en.capacidade_maxima`;
    if (onlyAvailable) sql += " HAVING disponivel > 0";
    sql += " ORDER BY en.codigo";
    return this.ok({ itens: this.rows(sql) });
  }

  saveProduct(data) {
    const numero = String(data.numero || "").trim();
    const codigo = String(data.codigo_barras || "").trim();
    const nome = String(data.nome || "").trim();
    const lote = String(data.lote || "").trim();
    const qc = Number.parseInt(data.unidades_por_caixa, 10) || 0;
    const fabricacao = this.normalizeDate(data.fabricacao);
    const vencimento = this.normalizeDate(data.vencimento);
    const endereco = String(data.endereco || "").trim().toUpperCase();
    const quantidade = Number.parseInt(data.quantidade_entrada, 10) || 0;
    if (!numero || !nome || !lote) this.fail("Informe número, nome e lote.");
    if (qc <= 0) this.fail("Unidades por caixa precisa ser maior que zero.");
    if (quantidade > 0 && !endereco) this.fail("Selecione um endereço para registrar a quantidade inicial.");
    if (endereco && quantidade <= 0) this.fail("Informe a quantidade inicial para usar o endereço selecionado.");

    const tx = this.db.transaction(() => {
      this.db.prepare("INSERT OR IGNORE INTO produtos(numero, codigo_barras, nome) VALUES (?, ?, ?)")
        .run(numero, codigo || null, nome);
      this.db.prepare("UPDATE produtos SET codigo_barras = ?, nome = ? WHERE numero = ?")
        .run(codigo || null, nome, numero);
      const pid = this.productId(numero);
      if (Object.prototype.hasOwnProperty.call(data, "estoque_minimo")) {
        const minimo = Number.parseInt(data.estoque_minimo, 10);
        if (!Number.isInteger(minimo) || minimo < 0) this.fail("O estoque mínimo precisa ser um número inteiro igual ou maior que zero.");
        this.db.prepare("UPDATE produtos SET estoque_minimo = ? WHERE id = ?").run(minimo, pid);
      }
      this.db.prepare("INSERT OR IGNORE INTO lotes(produto_id, lote, unidades_por_caixa, fabricacao, vencimento) VALUES (?, ?, ?, ?, ?)")
        .run(pid, lote, qc, fabricacao, vencimento);
      this.db.prepare("UPDATE lotes SET unidades_por_caixa = ?, fabricacao = ?, vencimento = ? WHERE produto_id = ? AND lote = ?")
        .run(qc, fabricacao, vencimento, pid, lote);
    });
    tx();

    if (quantidade > 0) {
      this.registerEntry({ numero, lote, endereco, quantidade });
      return this.ok({ message: "Produto salvo e endereçado com sucesso." });
    }
    return this.ok({ message: "Produto salvo com sucesso." });
  }

  registerEntry(data) {
    const numero = String(data.numero || "").trim();
    const lote = String(data.lote || "").trim();
    const endereco = String(data.endereco || "").trim().toUpperCase();
    const quantidade = Number.parseInt(data.quantidade, 10) || 0;
    if (!numero || !lote || !endereco) this.fail("Informe número do produto, lote e endereço.");
    if (quantidade <= 0) this.fail("Quantidade de entrada precisa ser maior que zero.");

    const tx = this.db.transaction(() => {
      const product = this.db.prepare(`SELECT l.id AS lote_id, p.numero, p.nome, l.lote AS lote_real
        FROM lotes l JOIN produtos p ON p.id = l.produto_id
        WHERE (TRIM(p.numero) = ? OR TRIM(COALESCE(p.codigo_barras, '')) = ?)
          AND UPPER(TRIM(l.lote)) = UPPER(?)`).get(numero, numero, lote);
      if (!product) {
        const existeProduto = this.db.prepare("SELECT 1 FROM produtos WHERE TRIM(numero)=? OR TRIM(COALESCE(codigo_barras,''))=?").get(numero, numero);
        if (!existeProduto) this.fail("Produto não encontrado. Confira o número ou código de barras cadastrado.");
        this.fail("Lote não encontrado para este produto. Use “Selecionar lote cadastrado” para escolher um lote existente.");
      }
      const enderecoId = this.addressId(endereco);
      if (enderecoId < 0) this.fail("Endereço não cadastrado. Cadastre o endereço e sua capacidade primeiro.");
      const loc = this.db.prepare(`SELECT en.capacidade_maxima,
        COALESCE(SUM(e.quantidade), 0) AS ocupado FROM enderecos en
        LEFT JOIN estoque e ON e.endereco_id = en.id WHERE en.id = ?
        GROUP BY en.id, en.capacidade_maxima`).get(enderecoId);
      if (!loc) this.fail("Não foi possível consultar a capacidade do endereço. Atualize os endereços e tente novamente.");
      const disponivel = Number(loc.capacidade_maxima) - Number(loc.ocupado);
      if (quantidade > disponivel)
        this.fail("Capacidade insuficiente no endereço " + endereco + ". Disponível: " + disponivel +
          " unidade(s). Entrada: " + quantidade + " unidade(s).");
      this.db.prepare("INSERT OR IGNORE INTO estoque(lote_id, endereco_id, quantidade) VALUES (?, ?, 0)")
        .run(product.lote_id, enderecoId);
      this.db.prepare("UPDATE estoque SET quantidade = quantidade + ? WHERE lote_id = ? AND endereco_id = ?")
        .run(quantidade, product.lote_id, enderecoId);
      const saldo = this.db.prepare("SELECT quantidade FROM estoque WHERE lote_id = ? AND endereco_id = ?")
        .get(product.lote_id, enderecoId).quantidade;
      this.addMovement("ENTRADA", product.numero, product.nome, product.lote_real, endereco, quantidade, saldo);
      return saldo;
    });
    const saldo = tx();
    return this.ok({ message: "Entrada registrada. Saldo atual: " + saldo + " unidade(s).", saldo });
  }

  listStock(filtro) {
    let sql = `SELECT p.id AS produto_id, l.id AS lote_id, p.numero, p.codigo_barras, p.nome, l.lote, l.unidades_por_caixa,
      l.fabricacao, l.vencimento, en.codigo AS endereco, e.quantidade
      FROM estoque e JOIN lotes l ON l.id = e.lote_id
      JOIN produtos p ON p.id = l.produto_id JOIN enderecos en ON en.id = e.endereco_id`;
    const params = [];
    if (filtro.trim()) { sql += " WHERE p.numero = ? OR p.codigo_barras = ?"; params.push(filtro.trim(), filtro.trim()); }
    sql += " ORDER BY p.numero, substr(l.vencimento, 7, 4) || '-' || substr(l.vencimento, 4, 2) || '-' || substr(l.vencimento, 1, 2), en.codigo";
    return this.ok({ itens: this.rows(sql, params) });
  }

  listLots(filtro) {
    filtro = filtro.trim();
    if (!filtro) this.fail("Informe o produto.");
    return this.ok({ itens: this.rows(`SELECT p.numero, p.codigo_barras, p.nome, l.lote,
      l.unidades_por_caixa, l.fabricacao, l.vencimento
      FROM lotes l JOIN produtos p ON p.id = l.produto_id
      WHERE p.numero = ? OR p.codigo_barras = ?
      ORDER BY substr(l.vencimento, 7, 4) || '-' || substr(l.vencimento, 4, 2) || '-' || substr(l.vencimento, 1, 2), l.lote`, [filtro, filtro]) });
  }

  editProduct(data) {
    const produtoId=Number(data.produto_id), loteId=Number(data.lote_id);
    const numero=String(data.numero||"").trim(), codigo=String(data.codigo_barras||"").trim();
    const nome=String(data.nome||"").trim(), lote=String(data.lote||"").trim();
    const qc=Number.parseInt(data.unidades_por_caixa,10)||0;
    const fabricacao=this.normalizeDate(data.fabricacao), vencimento=this.normalizeDate(data.vencimento);
    const minimoInformado=Object.prototype.hasOwnProperty.call(data,"estoque_minimo");
    const estoqueMinimo=Number.parseInt(data.estoque_minimo,10);
    if(minimoInformado&&(!Number.isInteger(estoqueMinimo)||estoqueMinimo<0)) this.fail("O estoque mínimo precisa ser um número inteiro igual ou maior que zero.");
    if(!produtoId||!loteId||!numero||!nome||!lote) this.fail("Confira o produto, lote, número e nome.");
    if(qc<=0) this.fail("Unidades por caixa precisa ser maior que zero.");
    if(!this.db.prepare("SELECT id FROM lotes WHERE id=? AND produto_id=?").get(loteId,produtoId)) this.fail("Produto ou lote não encontrado. Atualize a consulta.");
    try {
      this.db.transaction(()=>{
        this.db.prepare("UPDATE produtos SET numero=?,codigo_barras=?,nome=? WHERE id=?").run(numero,codigo||null,nome,produtoId);
        if(minimoInformado) this.db.prepare("UPDATE produtos SET estoque_minimo=? WHERE id=?").run(estoqueMinimo,produtoId);
        this.db.prepare("UPDATE lotes SET lote=?,unidades_por_caixa=?,fabricacao=?,vencimento=? WHERE id=?").run(lote,qc,fabricacao,vencimento,loteId);
      })();
    } catch(error) {
      if(String(error.message||"").includes("UNIQUE")) this.fail("Número, código de barras ou lote já cadastrado em outro registro.");
      throw error;
    }
    return this.ok({message:"Produto e lote atualizados. O saldo de estoque foi preservado."});
  }

  createOrder(data) {
    const cliente=String(data.cliente||"").trim(), criadoPor=String(data.criado_por||"").trim();
    const items=Array.isArray(data.itens)?data.itens:[];
    if(!items.length) this.fail("Adicione pelo menos um produto ao pedido.");
    const unique=new Map();
    for(const item of items){const pid=Number(item.produto_id),qty=Number.parseInt(item.quantidade,10)||0;if(!pid||qty<=0)this.fail("Cada item precisa de produto e quantidade maior que zero.");unique.set(pid,(unique.get(pid)||0)+qty);}
    const prefix="ORD-"+new Date().toISOString().slice(0,10).replace(/-/g,"")+"-";
    const numero=this.db.transaction(()=>{
      let seq=this.db.prepare("SELECT COUNT(*) AS n FROM pedidos WHERE numero LIKE ?").get(prefix+"%").n+1;
      let orderNo=prefix+String(seq).padStart(4,"0");
      while(this.db.prepare("SELECT 1 FROM pedidos WHERE numero=?").get(orderNo)){seq++;orderNo=prefix+String(seq).padStart(4,"0");}
      const result=this.db.prepare("INSERT INTO pedidos(numero,cliente,status,criado_em,criado_por) VALUES(?,?,'PENDENTE',?,?)").run(orderNo,cliente,this.now(),criadoPor);
      const insert=this.db.prepare("INSERT INTO pedido_itens(pedido_id,produto_id,quantidade,status) VALUES(?,?,?,'PENDENTE')");
      for(const [pid,qty] of unique){if(!this.db.prepare("SELECT id FROM produtos WHERE id=?").get(pid))this.fail("Um dos produtos selecionados não existe mais.");insert.run(result.lastInsertRowid,pid,qty);}
      return orderNo;
    })();
    return this.ok({numero,message:"Pedido criado. Número da ordem: "+numero});
  }

  listOrders(filtro) {
    const value=String(filtro||"").trim(),params=[];
    let sql=`SELECT p.id,p.numero,p.cliente,p.status,p.criado_em,p.criado_por,COUNT(i.id) AS total_itens,COALESCE(SUM(i.quantidade),0) AS total_unidades FROM pedidos p LEFT JOIN pedido_itens i ON i.pedido_id=p.id`;
    if(value){sql+=" WHERE p.numero LIKE ? OR p.cliente LIKE ?";params.push("%"+value+"%","%"+value+"%");}
    sql+=" GROUP BY p.id ORDER BY p.id DESC LIMIT 100";
    return this.ok({itens:this.rows(sql,params)});
  }

  getOrder(numero) {
    const pedido=this.db.prepare("SELECT id,numero,cliente,status,criado_em,criado_por FROM pedidos WHERE numero=?").get(String(numero||"").trim().toUpperCase());
    if(!pedido)this.fail("Ordem não encontrada. Confira o número com o responsável.");
    const itens=this.rows(`SELECT i.id AS item_id,i.produto_id,p.numero AS produto_numero,p.codigo_barras,p.nome,i.quantidade,i.status FROM pedido_itens i JOIN produtos p ON p.id=i.produto_id WHERE i.pedido_id=? ORDER BY i.id`,[pedido.id]);
    return this.ok({pedido,itens});
  }

  listProducts(filtro) {
    let sql = `SELECT p.id AS produto_id, l.id AS lote_id, p.numero, p.codigo_barras, p.nome, p.estoque_minimo,
      (SELECT COALESCE(SUM(e2.quantidade),0) FROM estoque e2 JOIN lotes l2 ON l2.id=e2.lote_id WHERE l2.produto_id=p.id) AS saldo_produto,
      l.lote, l.unidades_por_caixa, l.fabricacao, l.vencimento, COALESCE(SUM(e.quantidade), 0) AS saldo_total
      FROM produtos p JOIN lotes l ON l.produto_id = p.id
      LEFT JOIN estoque e ON e.lote_id = l.id`;
    const params = [];
    if (filtro.trim()) {
      sql += " WHERE p.numero = ? OR p.codigo_barras = ? OR p.nome LIKE ?";
      params.push(filtro.trim(), filtro.trim(), "%" + filtro.trim() + "%");
    }
    sql += ` GROUP BY p.id, p.numero, p.codigo_barras, p.nome, p.estoque_minimo, l.id, l.lote,
      l.unidades_por_caixa, l.fabricacao, l.vencimento
      ORDER BY p.numero, substr(l.vencimento, 7, 4) || '-' || substr(l.vencimento, 4, 2) || '-' || substr(l.vencimento, 1, 2), l.lote`;
    return this.ok({ itens: this.rows(sql, params) });
  }

  listLowStock() {
    const sql = `SELECT p.id AS produto_id, p.numero, p.codigo_barras, p.nome, p.estoque_minimo,
      COALESCE(SUM(e.quantidade), 0) AS saldo_total
      FROM produtos p
      LEFT JOIN lotes l ON l.produto_id = p.id
      LEFT JOIN estoque e ON e.lote_id = l.id
      GROUP BY p.id, p.numero, p.codigo_barras, p.nome, p.estoque_minimo
      HAVING p.estoque_minimo > 0 AND COALESCE(SUM(e.quantidade), 0) <= p.estoque_minimo
      ORDER BY (p.estoque_minimo - COALESCE(SUM(e.quantidade), 0)) DESC, p.numero`;
    return this.ok({ itens: this.rows(sql) });
  }

  listMovements(filtro) {
    let sql = "SELECT tipo, produto_numero, produto_nome, lote, endereco, quantidade, saldo_apos, data_hora FROM movimentacoes";
    const params = [];
    if (filtro.trim()) {
      sql += " WHERE produto_numero = ? OR produto_numero IN (SELECT numero FROM produtos WHERE codigo_barras = ?)";
      params.push(filtro.trim(), filtro.trim());
    }
    sql += " ORDER BY id DESC LIMIT 100";
    return this.ok({ itens: this.rows(sql, params) });
  }

  previewSeparation(data) {
    const numero = String(data.numero || "").trim();
    const pedida = Number.parseInt(data.quantidade, 10) || 0;
    if (!numero || pedida <= 0) this.fail("Informe produto e quantidade válida.");
    const saldos = this.rows(`SELECT e.id AS estoque_id, p.numero, p.nome, l.lote,
      l.unidades_por_caixa, l.vencimento, en.codigo AS endereco, e.quantidade
      FROM estoque e JOIN lotes l ON l.id = e.lote_id JOIN produtos p ON p.id = l.produto_id
      JOIN enderecos en ON en.id = e.endereco_id
      WHERE (p.numero = ? OR p.codigo_barras = ?) AND e.quantidade > 0
      ORDER BY substr(l.vencimento, 7, 4) || '-' || substr(l.vencimento, 4, 2) || '-' || substr(l.vencimento, 1, 2), en.codigo`, [numero, numero]);
    if (!saldos.length) this.fail("Produto não encontrado em estoque.");
    const total = saldos.reduce((sum, row) => sum + row.quantidade, 0);
    if (total < pedida) this.fail("Saldo insuficiente. Disponível: " + total + ". Solicitado: " + pedida + ".");
    let restante = pedida;
    const orientacoes = [];
    for (const row of saldos) {
      if (restante <= 0) break;
      const retirar = Math.min(restante, row.quantidade);
      const qc = row.unidades_por_caixa;
      orientacoes.push({
        estoque_id: row.estoque_id, produto: row.numero, nome: row.nome, lote: row.lote,
        vencimento: row.vencimento, endereco: row.endereco, quantidade_baixa: retirar,
        qtd_operador: retirar % qc === 0 ? retirar / qc : retirar,
        unidade_operador: retirar % qc === 0 ? "caixa(s)" : "unidade(s)"
      });
      restante -= retirar;
    }
    const token = { id: crypto.randomUUID(), orientacoes };
    return this.ok({ token: JSON.stringify(token), produto: orientacoes[0].produto,
      nome: orientacoes[0].nome, quantidade_pedida: pedida, orientacoes });
  }

  confirmSeparation(data) {
    let token;
    try { token = JSON.parse(data.token || "{}"); } catch { this.fail("Orientação inválida. Gere a separação novamente."); }
    const orientacoes = token.orientacoes || [];
    const confirmacoes = data.confirmacoes || [];
    if (!orientacoes.length || confirmacoes.length !== orientacoes.length)
      this.fail("Confirmação incompleta. Gere a orientação novamente.");
    for (let i = 0; i < orientacoes.length; i++) {
      const esperado = Number(orientacoes[i].qtd_operador);
      const confirmado = Number(confirmacoes.find(x => Number(x.index) === i)?.quantidade_confirmada);
      if (!Number.isFinite(confirmado) || esperado !== confirmado)
        this.fail("Quantidade confirmada diferente da orientação. Estoque não alterado.");
    }
    const orderId=Number(data.pedido_id)||0, orderItemId=Number(data.pedido_item_id)||0;
    if(orderItemId&&!orderId)this.fail("Ordem inválida. Acesse o pedido novamente.");
    if(orderItemId){const oi=this.db.prepare("SELECT i.id,i.pedido_id,i.status,i.quantidade,p.numero AS produto_numero FROM pedido_itens i JOIN produtos p ON p.id=i.produto_id WHERE i.id=?").get(orderItemId);if(!oi||oi.pedido_id!==orderId||oi.status!=="PENDENTE")this.fail("Este item da ordem já foi atendido ou não pertence a ela.");const baixada=orientacoes.reduce((sum,item)=>sum+Number(item.quantidade_baixa||0),0);if(orientacoes.some(item=>String(item.produto)!==String(oi.produto_numero))||baixada!==Number(oi.quantidade))this.fail("A orientação não corresponde ao produto e à quantidade da ordem. Estoque não alterado.");}
    const tx = this.db.transaction(() => {
      for (const item of orientacoes) {
        const atualRow = this.db.prepare("SELECT quantidade FROM estoque WHERE id = ?").get(item.estoque_id);
        if (!atualRow) this.fail("Estoque não encontrado. Gere a orientação novamente.");
        if (atualRow.quantidade < item.quantidade_baixa)
          this.fail("Saldo mudou e ficou insuficiente. Gere a orientação novamente.");
        const novoSaldo = atualRow.quantidade - item.quantidade_baixa;
        this.db.prepare("UPDATE estoque SET quantidade = ? WHERE id = ?").run(novoSaldo, item.estoque_id);
        this.addMovement("SAIDA", item.produto, item.nome, item.lote, item.endereco, item.quantidade_baixa, novoSaldo);
      }
      if(orderItemId){this.db.prepare("UPDATE pedido_itens SET status='CONCLUIDO' WHERE id=? AND status='PENDENTE'").run(orderItemId);const pending=this.db.prepare("SELECT COUNT(*) AS n FROM pedido_itens WHERE pedido_id=? AND status='PENDENTE'").get(orderId).n;this.db.prepare("UPDATE pedidos SET status=? WHERE id=?").run(pending?"EM_ANDAMENTO":"CONCLUIDO",orderId);}
    });
    tx();
    return this.ok({ message: "Separação confirmada e estoque atualizado." });
  }
}

module.exports = MyStockDatabase;