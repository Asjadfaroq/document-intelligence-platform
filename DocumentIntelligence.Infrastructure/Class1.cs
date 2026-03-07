using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Channels;
using DocumentIntelligence.Application;
using DocumentIntelligence.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Pgvector;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using UglyToad.PdfPig;
using UglyToad.PdfPig.Content;

namespace DocumentIntelligence.Infrastructure;

public class ApplicationDbContext : DbContext, IApplicationDbContext
{
    public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : base(options)
    {
    }

    public DbSet<Tenant> Tenants => Set<Tenant>();
    public DbSet<User> Users => Set<User>();
    public DbSet<Workspace> Workspaces => Set<Workspace>();
    public DbSet<Document> Documents => Set<Document>();
    public DbSet<DocumentChunk> DocumentChunks => Set<DocumentChunk>();
    public DbSet<Question> Questions => Set<Question>();
    public DbSet<Answer> Answers => Set<Answer>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();

    IQueryable<Tenant> IApplicationDbContext.Tenants => Tenants.AsQueryable();
    IQueryable<User> IApplicationDbContext.Users => Users.AsQueryable();
    IQueryable<Workspace> IApplicationDbContext.Workspaces => Workspaces.AsQueryable();
    IQueryable<Document> IApplicationDbContext.Documents => Documents.AsQueryable();

    public async Task AddAsync<TEntity>(TEntity entity, CancellationToken cancellationToken) where TEntity : class
    {
        await Set<TEntity>().AddAsync(entity, cancellationToken);
    }

    public Task<int> SaveChangesAsync(CancellationToken cancellationToken)
    {
        return base.SaveChangesAsync(cancellationToken);
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<Tenant>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Name).IsRequired().HasMaxLength(200);
            entity.Property(x => x.Slug).IsRequired().HasMaxLength(200);
            entity.Property(x => x.CreatedAt).HasDefaultValueSql("timezone('utc', now())");
        });

        modelBuilder.Entity<User>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.HasIndex(x => new { x.Email, x.TenantId }).IsUnique();
            entity.Property(x => x.Email).IsRequired().HasMaxLength(256);
            entity.Property(x => x.PasswordHash).IsRequired();
            entity.Property(x => x.Role).IsRequired();
            entity.Property(x => x.CreatedAt).HasDefaultValueSql("timezone('utc', now())");

            entity.HasOne(x => x.Tenant)
                .WithMany(t => t.Users)
                .HasForeignKey(x => x.TenantId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Workspace>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Name).IsRequired().HasMaxLength(200);
            entity.Property(x => x.Description).HasMaxLength(1000);
            entity.Property(x => x.CreatedAt).HasDefaultValueSql("timezone('utc', now())");

            entity.HasOne(x => x.Tenant)
                .WithMany(t => t.Workspaces)
                .HasForeignKey(x => x.TenantId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Document>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.FileName).IsRequired().HasMaxLength(500);
            entity.Property(x => x.StoragePath).IsRequired().HasMaxLength(1000);
            entity.Property(x => x.Language).HasMaxLength(10);
            entity.Property(x => x.Status).IsRequired();
            entity.Property(x => x.CreatedAt).HasDefaultValueSql("timezone('utc', now())");

            entity.HasOne(x => x.Workspace)
                .WithMany()
                .HasForeignKey(x => x.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<DocumentChunk>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Content).IsRequired();
            entity.Property(x => x.MetadataJson);
            var embeddingComparer = new ValueComparer<float[]?>(
                (l, r) => ReferenceEquals(l, r) || (l != null && r != null && l.SequenceEqual(r)),
                v => v == null ? 0 : v.Aggregate(0, (acc, item) => HashCode.Combine(acc, item)),
                v => v == null ? null : v.ToArray());
            entity.Property(x => x.Embedding)
                .HasConversion(
                    f => f == null ? null : new Vector(f),
                    v => v == null ? null : v.ToArray())
                .Metadata.SetValueComparer(embeddingComparer);

            entity.Property(x => x.Embedding)
                .HasColumnType("vector(384)");

            entity.HasOne(x => x.Document)
                .WithMany()
                .HasForeignKey(x => x.DocumentId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Question>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.QuestionText).IsRequired();
            entity.Property(x => x.CreatedAt).HasDefaultValueSql("timezone('utc', now())");
        });

        modelBuilder.Entity<Answer>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.AnswerText).IsRequired();
            entity.Property(x => x.SourcesJson);
            entity.Property(x => x.ModelName).HasMaxLength(200);

            entity.HasOne<Question>()
                .WithMany()
                .HasForeignKey(x => x.QuestionId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<RefreshToken>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.TokenHash).IsRequired().HasMaxLength(64);
            entity.HasIndex(x => x.TokenHash);

            entity.HasOne(x => x.User)
                .WithMany()
                .HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }
}

public class PasswordHasher : IPasswordHasher
{
    public string Hash(string password)
    {
        using var rng = RandomNumberGenerator.Create();
        var saltBytes = new byte[16];
        rng.GetBytes(saltBytes);
        var salt = Convert.ToBase64String(saltBytes);

        var hash = HashInternal(password, saltBytes);
        return $"{salt}.{Convert.ToBase64String(hash)}";
    }

    public bool Verify(string password, string hash)
    {
        var parts = hash.Split('.', 2);
        if (parts.Length != 2)
        {
            return false;
        }

        var saltBytes = Convert.FromBase64String(parts[0]);
        var storedHash = parts[1];

        var computedHash = HashInternal(password, saltBytes);
        var computedHashBase64 = Convert.ToBase64String(computedHash);

        return CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(storedHash),
            Encoding.UTF8.GetBytes(computedHashBase64));
    }

    private static byte[] HashInternal(string password, byte[] salt)
    {
        using var pbkdf2 = new Rfc2898DeriveBytes(password, salt, 100_000, HashAlgorithmName.SHA256);
        return pbkdf2.GetBytes(32);
    }
}

public class JwtTokenGenerator : IJwtTokenGenerator
{
    private readonly IConfiguration _configuration;

    public JwtTokenGenerator(IConfiguration configuration)
    {
        _configuration = configuration;
    }

    public TimeSpan GetAccessTokenLifespan()
    {
        var minutes = 15;
        var config = _configuration["Jwt:AccessTokenExpirationMinutes"] ?? _configuration["Jwt__AccessTokenExpirationMinutes"];
        if (!string.IsNullOrWhiteSpace(config) && int.TryParse(config, out var parsed) && parsed > 0)
            minutes = Math.Min(parsed, 60 * 24); // cap at 24h
        return TimeSpan.FromMinutes(minutes);
    }

    public string GenerateToken(User user)
    {
        var secret = _configuration["Jwt:Secret"] ?? _configuration["Jwt__Secret"];
        if (string.IsNullOrWhiteSpace(secret))
            throw new InvalidOperationException("JWT secret is not configured.");

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var lifespan = GetAccessTokenLifespan();

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new(JwtRegisteredClaimNames.Email, user.Email),
            new("tenantId", user.TenantId.ToString()),
            new(ClaimTypes.Role, user.Role.ToString())
        };

        var token = new JwtSecurityToken(
            issuer: "document-intelligence",
            audience: "document-intelligence",
            claims: claims,
            expires: DateTime.UtcNow.Add(lifespan),
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}

public class RefreshTokenStore : IRefreshTokenStore
{
    private readonly ApplicationDbContext _db;
    private readonly IConfiguration _configuration;

    public RefreshTokenStore(ApplicationDbContext db, IConfiguration configuration)
    {
        _db = db;
        _configuration = configuration;
    }

    private static string HashToken(string token)
    {
        var bytes = Encoding.UTF8.GetBytes(token);
        var hash = SHA256.HashData(bytes);
        return Convert.ToHexString(hash);
    }

    private int GetRefreshTokenExpirationDays()
    {
        var config = _configuration["Jwt:RefreshTokenExpirationDays"] ?? _configuration["Jwt__RefreshTokenExpirationDays"];
        if (!string.IsNullOrWhiteSpace(config) && int.TryParse(config, out var days) && days > 0)
            return Math.Min(days, 30);
        return 7;
    }

    public async Task<(string Token, DateTime ExpiresAtUtc)> CreateAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        var bytes = new byte[48];
        RandomNumberGenerator.Fill(bytes);
        var token = Convert.ToBase64String(bytes).Replace("+", "-").Replace("/", "_").TrimEnd('=');
        var hash = HashToken(token);
        var expiresAt = DateTime.UtcNow.AddDays(GetRefreshTokenExpirationDays());

        var entity = new RefreshToken
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            TokenHash = hash,
            ExpiresAtUtc = expiresAt,
            CreatedAtUtc = DateTime.UtcNow
        };
        await _db.RefreshTokens.AddAsync(entity, cancellationToken);
        await _db.SaveChangesAsync(cancellationToken);
        return (token, expiresAt);
    }

    public async Task<User?> GetUserByTokenAsync(string token, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(token)) return null;
        var hash = HashToken(token);
        var refreshToken = await _db.RefreshTokens
            .Where(rt => rt.TokenHash == hash && rt.ExpiresAtUtc > DateTime.UtcNow)
            .Include(rt => rt.User)
            .ThenInclude(u => u.Tenant)
            .FirstOrDefaultAsync(cancellationToken);
        return refreshToken?.User;
    }

    public async Task RevokeAsync(string token, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(token)) return;
        var hash = HashToken(token);
        var existing = await _db.RefreshTokens
            .Where(rt => rt.TokenHash == hash)
            .ToListAsync(cancellationToken);
        _db.RefreshTokens.RemoveRange(existing);
        await _db.SaveChangesAsync(cancellationToken);
    }
}

public class SupabaseStorageService : IStorageService
{
    private readonly HttpClient _httpClient;
    private readonly IConfiguration _configuration;

    public SupabaseStorageService(HttpClient httpClient, IConfiguration configuration)
    {
        _httpClient = httpClient;
        _configuration = configuration;
    }

    private static string SanitizeStorageFileName(string fileName)
    {
        var baseName = Path.GetFileName(fileName);
        var sanitized = new string(
            baseName
                .Select(c => char.IsLetterOrDigit(c) || c == '.' || c == '-' || c == '_' ? c : '-')
                .ToArray());

        while (sanitized.Contains("--", StringComparison.Ordinal))
        {
            sanitized = sanitized.Replace("--", "-", StringComparison.Ordinal);
        }

        sanitized = sanitized.Trim('-', '.');
        if (string.IsNullOrWhiteSpace(sanitized))
        {
            sanitized = "document.pdf";
        }

        return sanitized;
    }

    public async Task<string> UploadDocumentAsync(
        Guid tenantId,
        Guid workspaceId,
        string fileName,
        Stream content,
        CancellationToken cancellationToken)
    {
        var baseUrl = (_configuration["SUPABASE_URL"] ?? throw new InvalidOperationException("SUPABASE_URL is not configured.")).Trim();
        var anonKey = (_configuration["SUPABASE_ANON_KEY"] ?? throw new InvalidOperationException("SUPABASE_ANON_KEY is not configured.")).Trim();
        var serviceKey = (_configuration["SUPABASE_SERVICE_ROLE_KEY"] ?? throw new InvalidOperationException("SUPABASE_SERVICE_ROLE_KEY is not configured.")).Trim();
        var bucket = (_configuration["SUPABASE_BUCKET"] ?? "documents").Trim();

        var safeFileName = SanitizeStorageFileName(fileName);
        var objectPath = $"tenants/{tenantId}/workspaces/{workspaceId}/{Guid.NewGuid()}_{safeFileName}";

        var baseUri = new Uri(baseUrl, UriKind.Absolute);
        var objectUri = new Uri(baseUri, $"/storage/v1/object/{bucket}/{objectPath}");

        using var requestMessage = new HttpRequestMessage(HttpMethod.Post, objectUri)
        {
            Content = new StreamContent(content)
        };
        requestMessage.Headers.Add("apikey", anonKey);
        requestMessage.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", serviceKey);

        var response = await _httpClient.SendAsync(requestMessage, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new InvalidOperationException($"Failed to upload to Supabase Storage. Status: {response.StatusCode}, Body: {body}");
        }

        return $"{bucket}/{objectPath}";
    }
}

public class HuggingFaceEmbeddingService : IEmbeddingService
{
    private readonly HttpClient _httpClient;
    private readonly IConfiguration _configuration;

    public HuggingFaceEmbeddingService(HttpClient httpClient, IConfiguration configuration)
    {
        _httpClient = httpClient;
        _configuration = configuration;
    }

    /// <summary>Strips control characters (e.g. \r from Windows .env) so values are safe for headers/URLs.</summary>
    private static string SanitizeHfConfig(string value) =>
        string.IsNullOrEmpty(value) ? value : string.Concat(value.Trim().Where(c => !char.IsControl(c)));

    public async Task<float[]> GetEmbeddingAsync(string text, CancellationToken cancellationToken)
    {
        var apiKey = SanitizeHfConfig(_configuration["HUGGINGFACE_API_KEY"] ?? throw new InvalidOperationException("HUGGINGFACE_API_KEY not configured."));
        var model = SanitizeHfConfig(_configuration["HUGGINGFACE_EMBEDDING_MODEL"]
                    ?? throw new InvalidOperationException("HUGGINGFACE_EMBEDDING_MODEL not set."));
        var dim = int.Parse(_configuration["EMBEDDING_DIMENSION"] ?? "384", CultureInfo.InvariantCulture);

        var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"https://router.huggingface.co/hf-inference/models/{model}/pipeline/feature-extraction");

        request.Headers.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", apiKey);

        request.Content = new StringContent(
            System.Text.Json.JsonSerializer.Serialize(new { inputs = new[] { text } }),
            Encoding.UTF8,
            "application/json");

        var response = await _httpClient.SendAsync(request, cancellationToken);
        var json = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"HuggingFace embedding error ({response.StatusCode}): {json}");
        }

        using var doc = System.Text.Json.JsonDocument.Parse(json);
        var vector = doc.RootElement[0]
            .EnumerateArray()
            .Select(e => e.GetSingle())
            .ToArray();

        if (vector.Length != dim)
        {
            throw new InvalidOperationException($"Embedding dimension mismatch. Expected {dim}, got {vector.Length}.");
        }

        return vector;
    }
}

public class HuggingFaceLLMClient : ILLMClient
{
    private readonly HttpClient _httpClient;
    private readonly IConfiguration _configuration;

    public HuggingFaceLLMClient(HttpClient httpClient, IConfiguration configuration)
    {
        _httpClient = httpClient;
        _configuration = configuration;
    }

    /// <summary>Strips control characters (e.g. \r from Windows .env) so values are safe for headers/URLs.</summary>
    private static string SanitizeHfConfig(string value) =>
        string.IsNullOrEmpty(value) ? value : string.Concat(value.Trim().Where(c => !char.IsControl(c)));

    public async Task<string> GenerateAnswerAsync(string question, string context, string? languageHint, CancellationToken cancellationToken)
    {
        var apiKey = SanitizeHfConfig(_configuration["HUGGINGFACE_API_KEY"]
            ?? throw new InvalidOperationException("HUGGINGFACE_API_KEY not set."));
        var model = SanitizeHfConfig(_configuration["HUGGINGFACE_LLM_MODEL"]
            ?? throw new InvalidOperationException("HUGGINGFACE_LLM_MODEL not set."));

        var languageInstruction = string.IsNullOrWhiteSpace(languageHint)
            ? ""
            : languageHint.Trim().Equals("ar", StringComparison.OrdinalIgnoreCase)
                ? " Answer in Arabic only."
                : " Answer in English only.";

        var prompt = $"Context:\n{context}\n\nQuestion:\n{question}\n\nInstructions:{languageInstruction}\n\nAnswer:";

        var payload = new
        {
            model = model,
            messages = new[]
            {
                new { role = "user", content = prompt }
            },
            max_tokens = 256,
            temperature = 0.2
        };

        // Use Responses API: https://router.huggingface.co/v1 (model in body, not URL)
        var request = new HttpRequestMessage(
            HttpMethod.Post,
            "https://router.huggingface.co/v1/chat/completions");

        request.Headers.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", apiKey);

        request.Content = new StringContent(
            System.Text.Json.JsonSerializer.Serialize(payload),
            Encoding.UTF8,
            "application/json");

        var response = await _httpClient.SendAsync(request, cancellationToken);
        var json = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            // Give a clear fix when no Inference Provider is enabled
            if (response.StatusCode == System.Net.HttpStatusCode.BadRequest && json.Contains("model_not_supported", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException(
                    "Hugging Face model is not available: enable at least one Inference Provider in your account at https://hf.co/settings/inference-providers (e.g. HF Inference or Groq), then retry.");
            }
            throw new InvalidOperationException(
                $"HuggingFace LLM error ({response.StatusCode}): {json}");
        }

        using var doc = System.Text.Json.JsonDocument.Parse(json);
        return doc.RootElement
            .GetProperty("choices")[0]
            .GetProperty("message")
            .GetProperty("content")
            .GetString()?.Trim() ?? string.Empty;
    }
}

public class VectorSearchService : IVectorSearchService
{
    private readonly ApplicationDbContext _db;

    public VectorSearchService(ApplicationDbContext db)
    {
        _db = db;
    }

    public async Task<IReadOnlyList<RetrievalChunkDto>> SearchChunksAsync(
        Guid tenantId,
        Guid workspaceId,
        float[] queryEmbedding,
        string question,
        AskSearchMode mode,
        int topK,
        CancellationToken cancellationToken)
    {
        var vector = new Vector(queryEmbedding);
        var results = mode == AskSearchMode.Hybrid
            ? await _db.Database
                .SqlQueryRaw<RetrievalChunkDto>(
                    """
                    SELECT sub."ChunkId", sub."Content", sub."DocumentId", sub."FileName"
                    FROM (
                        SELECT
                            c."Id" AS "ChunkId",
                            c."Content",
                            c."DocumentId",
                            d."FileName",
                            ((1 - (c."Embedding" <=> {2})) * 0.7
                             + ts_rank_cd(to_tsvector('simple', c."Content"), plainto_tsquery('simple', {3})) * 0.3) AS score
                        FROM "DocumentChunks" c
                        INNER JOIN "Documents" d ON d."Id" = c."DocumentId"
                        WHERE c."TenantId" = {0}
                          AND d."WorkspaceId" = {1}
                          AND c."Embedding" IS NOT NULL
                    ) sub
                    ORDER BY sub.score DESC
                    LIMIT {4}
                    """,
                    tenantId,
                    workspaceId,
                    vector,
                    question,
                    topK)
                .ToListAsync(cancellationToken)
            : await _db.Database
                .SqlQueryRaw<RetrievalChunkDto>(
                    """
                    SELECT c."Id" AS "ChunkId", c."Content", c."DocumentId", d."FileName"
                    FROM "DocumentChunks" c
                    INNER JOIN "Documents" d ON d."Id" = c."DocumentId"
                    WHERE c."TenantId" = {0} AND d."WorkspaceId" = {1} AND c."Embedding" IS NOT NULL
                    ORDER BY c."Embedding" <-> {2}
                    LIMIT {3}
                    """,
                    tenantId,
                    workspaceId,
                    vector,
                    topK)
                .ToListAsync(cancellationToken);

        return results;
    }
}

public class InMemoryIngestionQueue : IIngestionQueue
{
    private readonly Channel<DocumentIngestionMessage> _channel;

    public InMemoryIngestionQueue()
    {
        _channel = Channel.CreateUnbounded<DocumentIngestionMessage>();
    }

    public async Task EnqueueAsync(DocumentIngestionMessage message, CancellationToken cancellationToken)
    {
        await _channel.Writer.WriteAsync(message, cancellationToken);
    }

    public ChannelReader<DocumentIngestionMessage> Reader => _channel.Reader;
}

public sealed class InMemoryCacheService : ICacheService
{
    private readonly IMemoryCache _cache;

    public InMemoryCacheService(IMemoryCache cache)
    {
        _cache = cache;
    }

    public async Task<T> GetOrSetAsync<T>(string key, TimeSpan ttl, Func<CancellationToken, Task<T>> factory, CancellationToken cancellationToken = default)
    {
        if (_cache.TryGetValue(key, out T? cached) && cached is not null)
            return cached;

        var value = await factory(cancellationToken);
        _cache.Set(key, value, new MemoryCacheEntryOptions().SetAbsoluteExpiration(ttl));
        return value;
    }

    public Task InvalidateAsync(string key, CancellationToken cancellationToken = default)
    {
        _cache.Remove(key);
        return Task.CompletedTask;
    }
}

public sealed class WorkspaceAccessService : IWorkspaceAccessService
{
    private readonly IApplicationDbContext _db;

    public WorkspaceAccessService(IApplicationDbContext db)
    {
        _db = db;
    }

    public async Task<bool> WorkspaceBelongsToTenantAsync(Guid workspaceId, Guid tenantId, CancellationToken cancellationToken = default)
    {
        return await _db.Workspaces.AnyAsync(w => w.Id == workspaceId && w.TenantId == tenantId, cancellationToken);
    }
}

public class DocumentIngestionWorker : BackgroundService
{
    private readonly IServiceProvider _serviceProvider;
    private readonly InMemoryIngestionQueue _queue;

    public DocumentIngestionWorker(IServiceProvider serviceProvider, IIngestionQueue queue)
    {
        _serviceProvider = serviceProvider;
        _queue = (InMemoryIngestionQueue)queue;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var message in _queue.Reader.ReadAllAsync(stoppingToken))
        {
            using var scope = _serviceProvider.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            var configuration = scope.ServiceProvider.GetRequiredService<IConfiguration>();
            var httpClientFactory = scope.ServiceProvider.GetRequiredService<IHttpClientFactory>();
            var embeddingService = scope.ServiceProvider.GetRequiredService<IEmbeddingService>();
            var log = scope.ServiceProvider.GetRequiredService<ILogger<DocumentIngestionWorker>>();

            var document = await db.Documents.FirstOrDefaultAsync(d => d.Id == message.DocumentId, stoppingToken);
            if (document is null)
            {
                log.LogWarning("Ingestion skipped: DocumentId={DocumentId} not found", message.DocumentId);
                continue;
            }

            using (log.BeginScope(new Dictionary<string, object?>
            {
                ["DocumentId"] = message.DocumentId,
                ["TenantId"] = message.TenantId,
                ["FileName"] = document.FileName
            }))
            {
                document.Status = DocumentStatus.Processing;
                await db.SaveChangesAsync(stoppingToken);
                log.LogInformation("Document ingestion started");

                try
                {
                var httpClient = httpClientFactory.CreateClient(nameof(SupabaseStorageService));
                var baseUrl = (configuration["SUPABASE_URL"] ?? throw new InvalidOperationException("SUPABASE_URL is not configured.")).Trim();
                var serviceKey = (configuration["SUPABASE_SERVICE_ROLE_KEY"] ?? throw new InvalidOperationException("SUPABASE_SERVICE_ROLE_KEY is not configured.")).Trim();
                var bucket = (configuration["SUPABASE_BUCKET"] ?? "documents").Trim();

                var baseUri = new Uri(baseUrl, UriKind.Absolute);
                var objectUri = new Uri(baseUri, $"/storage/v1/object/{document.StoragePath}");

                using var requestMessage = new HttpRequestMessage(HttpMethod.Get, objectUri);
                requestMessage.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", serviceKey);

                var response = await httpClient.SendAsync(requestMessage, stoppingToken);
                response.EnsureSuccessStatusCode();

                await using var pdfStream = await response.Content.ReadAsStreamAsync(stoppingToken);

                using var pdf = PdfDocument.Open(pdfStream);

                var chunks = new List<DocumentChunk>();
                var chunkIndex = 0;

                foreach (var page in pdf.GetPages())
                {
                    var text = page.Text;
                    if (string.IsNullOrWhiteSpace(text))
                    {
                        continue;
                    }

                    var normalized = text.Trim();
                    var pageChunks = SplitTextIntoChunks(normalized, 900, 150);
                    var partIndex = 0;
                    foreach (var chunkText in pageChunks)
                    {
                        var embedding = await embeddingService.GetEmbeddingAsync(chunkText, stoppingToken);

                        var chunk = new DocumentChunk
                        {
                            Id = Guid.NewGuid(),
                            DocumentId = document.Id,
                            TenantId = document.TenantId,
                            PageNumber = page.Number,
                            ChunkIndex = chunkIndex++,
                            Content = chunkText,
                            Embedding = embedding,
                            MetadataJson = $"{{\"page\":{page.Number},\"part\":{partIndex++}}}"
                        };

                        chunks.Add(chunk);
                    }
                }

                if (chunks.Count > 0)
                {
                    await db.AddRangeAsync(chunks, stoppingToken);
                }

                document.Status = DocumentStatus.Ready;
                await db.SaveChangesAsync(stoppingToken);
                log.LogInformation("Document ingestion completed: Chunks={ChunkCount}", chunks.Count);
                }
                catch (Exception ex)
                {
                    document.Status = DocumentStatus.Failed;
                    await db.SaveChangesAsync(stoppingToken);
                    log.LogError(ex, "Document ingestion failed");
                }
            }
        }
    }

    private static IReadOnlyList<string> SplitTextIntoChunks(string text, int chunkSize, int overlap)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return [];
        }

        var compact = string.Join(' ', text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        if (compact.Length <= chunkSize)
        {
            return [compact];
        }

        var chunks = new List<string>();
        var step = Math.Max(1, chunkSize - overlap);
        var start = 0;

        while (start < compact.Length)
        {
            var length = Math.Min(chunkSize, compact.Length - start);
            var end = start + length;
            if (end < compact.Length)
            {
                var lastSpace = compact.LastIndexOf(' ', end - 1, length);
                if (lastSpace > start + (chunkSize / 2))
                {
                    end = lastSpace;
                }
            }

            var chunk = compact[start..end].Trim();
            if (!string.IsNullOrWhiteSpace(chunk))
            {
                chunks.Add(chunk);
            }

            if (end >= compact.Length)
            {
                break;
            }

            start = Math.Max(0, end - overlap);
        }

        return chunks;
    }
}
