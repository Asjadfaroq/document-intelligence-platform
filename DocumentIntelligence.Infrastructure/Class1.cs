using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using DocumentIntelligence.Application;
using DocumentIntelligence.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.IdentityModel.Tokens;
using Pgvector;
using StackExchange.Redis;
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
    public DbSet<TenantInvite> TenantInvites => Set<TenantInvite>();

    IQueryable<Tenant> IApplicationDbContext.Tenants => Tenants.AsQueryable();
    IQueryable<User> IApplicationDbContext.Users => Users.AsQueryable();
    IQueryable<Workspace> IApplicationDbContext.Workspaces => Workspaces.AsQueryable();
    IQueryable<Document> IApplicationDbContext.Documents => Documents.AsQueryable();
    IQueryable<TenantInvite> IApplicationDbContext.TenantInvites => TenantInvites.AsQueryable();

    public override async ValueTask<EntityEntry<TEntity>> AddAsync<TEntity>(TEntity entity, CancellationToken cancellationToken = default) where TEntity : class
    {
        return await base.AddAsync(entity, cancellationToken);
    }

    async Task IApplicationDbContext.AddAsync<TEntity>(TEntity entity, CancellationToken cancellationToken)
    {
        await AddAsync(entity, cancellationToken);
    }

    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
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

        modelBuilder.Entity<TenantInvite>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Email).IsRequired().HasMaxLength(256);
            entity.Property(x => x.Code).IsRequired().HasMaxLength(64);
            entity.Property(x => x.Role).IsRequired();
            entity.Property(x => x.CreatedAt).HasDefaultValueSql("timezone('utc', now())");
            entity.Property(x => x.ExpiresAt).IsRequired();
            entity.Property(x => x.IsUsed).IsRequired();
            entity.HasIndex(x => x.Code).IsUnique();

            entity.HasOne(x => x.Tenant)
                .WithMany()
                .HasForeignKey(x => x.TenantId)
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

/// <summary>Refresh tokens in Redis for fast lookup and immediate revocation. Use when Redis is configured.</summary>
public sealed class RedisRefreshTokenStore : IRefreshTokenStore
{
    private const string KeyPrefix = "refresh:";
    private readonly IConnectionMultiplexer _redis;
    private readonly ApplicationDbContext _db;
    private readonly IConfiguration _configuration;

    public RedisRefreshTokenStore(IConnectionMultiplexer redis, ApplicationDbContext db, IConfiguration configuration)
    {
        _redis = redis;
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

    public Task<(string Token, DateTime ExpiresAtUtc)> CreateAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        var bytes = new byte[48];
        RandomNumberGenerator.Fill(bytes);
        var token = Convert.ToBase64String(bytes).Replace("+", "-").Replace("/", "_").TrimEnd('=');
        var hash = HashToken(token);
        var days = GetRefreshTokenExpirationDays();
        var expiresAt = DateTime.UtcNow.AddDays(days);
        var ttl = TimeSpan.FromDays(days);
        var key = KeyPrefix + hash;
        var redisDb = _redis.GetDatabase();
        redisDb.StringSet(key, userId.ToString(), ttl, when: When.Always);
        return Task.FromResult((token, expiresAt));
    }

    public async Task<User?> GetUserByTokenAsync(string token, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(token)) return null;
        var hash = HashToken(token);
        var key = KeyPrefix + hash;
        var redisDb = _redis.GetDatabase();
        var userIdStr = await redisDb.StringGetAsync(key);
        if (userIdStr.IsNullOrEmpty || !Guid.TryParse(userIdStr.ToString(), out var userId))
            return null;
        var user = await _db.Users
            .Include(u => u.Tenant)
            .FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);
        return user;
    }

    public Task RevokeAsync(string token, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(token)) return Task.CompletedTask;
        var hash = HashToken(token);
        var key = KeyPrefix + hash;
        var redisDb = _redis.GetDatabase();
        return redisDb.KeyDeleteAsync(key);
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

    public async Task DeleteObjectAsync(string storagePath, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(storagePath)) return;
        var firstSlash = storagePath.IndexOf('/');
        if (firstSlash <= 0 || firstSlash == storagePath.Length - 1) return;
        var bucket = storagePath[..firstSlash];
        var objectPath = storagePath[(firstSlash + 1)..];
        var baseUrl = (_configuration["SUPABASE_URL"] ?? throw new InvalidOperationException("SUPABASE_URL is not configured.")).Trim();
        var serviceKey = (_configuration["SUPABASE_SERVICE_ROLE_KEY"] ?? throw new InvalidOperationException("SUPABASE_SERVICE_ROLE_KEY is not configured.")).Trim();
        var baseUri = new Uri(baseUrl, UriKind.Absolute);
        var deleteUri = new Uri(baseUri, $"/storage/v1/object/{bucket}/{objectPath}");
        using var request = new HttpRequestMessage(HttpMethod.Delete, deleteUri);
        request.Headers.Add("apikey", (_configuration["SUPABASE_ANON_KEY"] ?? "").Trim());
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", serviceKey);
        var response = await _httpClient.SendAsync(request, cancellationToken);
        if (response.StatusCode == System.Net.HttpStatusCode.NotFound) return;
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new InvalidOperationException($"Failed to delete from Supabase Storage. Status: {response.StatusCode}, Body: {body}");
        }
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

    public async Task<float[]> GetEmbeddingAsync(string text, CancellationToken cancellationToken)
    {
        var apiKey = ConfigHelpers.Sanitize(_configuration["HUGGINGFACE_API_KEY"] ?? throw new InvalidOperationException("HUGGINGFACE_API_KEY not configured."));
        var model = ConfigHelpers.Sanitize(_configuration["HUGGINGFACE_EMBEDDING_MODEL"]
                    ?? throw new InvalidOperationException("HUGGINGFACE_EMBEDDING_MODEL not set."));
        var dim = int.Parse(_configuration["EMBEDDING_DIMENSION"] ?? "384", CultureInfo.InvariantCulture);

        var request = new HttpRequestMessage(HttpMethod.Post, $"/hf-inference/models/{model}/pipeline/feature-extraction");

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
            if (response.StatusCode == System.Net.HttpStatusCode.PaymentRequired ||
                json.Contains("depleted your monthly", StringComparison.OrdinalIgnoreCase) ||
                (json.Contains("depleted", StringComparison.OrdinalIgnoreCase) && json.Contains("credits", StringComparison.OrdinalIgnoreCase)))
            {
                throw new InvalidOperationException(
                    "HUGGINGFACE_CREDITS_EXHAUSTED: AI service credits are out of stock. Please try again later or contact your administrator.");
            }
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

    public async Task<string> GenerateAnswerAsync(string question, string context, string? languageHint, CancellationToken cancellationToken)
    {
        var apiKey = ConfigHelpers.Sanitize(_configuration["HUGGINGFACE_API_KEY"] ?? throw new InvalidOperationException("HUGGINGFACE_API_KEY not set."));
        var model = ConfigHelpers.Sanitize(_configuration["HUGGINGFACE_LLM_MODEL"] ?? throw new InvalidOperationException("HUGGINGFACE_LLM_MODEL not set."));

        var prompt = RagPrompt.BuildSystemContent(languageHint) + "\n\nContext:\n" + context + "\n\nQuestion: " + question + "\n\nAnswer:";

        var payload = new { model, messages = new[] { new { role = "user", content = prompt } }, max_tokens = 512, temperature = 0.15 };

        var request = new HttpRequestMessage(HttpMethod.Post, "/v1/chat/completions");
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", apiKey);
        request.Content = new StringContent(System.Text.Json.JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");

        var response = await _httpClient.SendAsync(request, cancellationToken);
        var json = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            if (response.StatusCode == System.Net.HttpStatusCode.BadRequest && json.Contains("model_not_supported", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Hugging Face model is not available: enable at least one Inference Provider at https://hf.co/settings/inference-providers.");
            if (response.StatusCode == System.Net.HttpStatusCode.PaymentRequired || (json.Contains("depleted", StringComparison.OrdinalIgnoreCase) && json.Contains("credits", StringComparison.OrdinalIgnoreCase)))
                throw new InvalidOperationException("HUGGINGFACE_CREDITS_EXHAUSTED: AI service credits are out of stock. Please try again later.");
            throw new InvalidOperationException($"HuggingFace LLM error ({response.StatusCode}): {json}");
        }

        return OpenAiChatResponse.ParseContent(json);
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
                            ((1 - (c."Embedding" <=> {2})) * 0.6
                             + COALESCE(ts_rank_cd(to_tsvector('simple', c."Content"), plainto_tsquery('simple', {3})), 0) * 0.4) AS score
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

/// <summary>Redis-backed cache for workspace and document lists. Use when ConnectionStrings:Redis is set.</summary>
public sealed class RedisCacheService : ICacheService
{
    private readonly IDatabase _db;
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public RedisCacheService(IConnectionMultiplexer redis)
    {
        _db = redis.GetDatabase();
    }

    public async Task<T> GetOrSetAsync<T>(string key, TimeSpan ttl, Func<CancellationToken, Task<T>> factory, CancellationToken cancellationToken = default)
    {
        try
        {
            var raw = await _db.StringGetAsync(key);
            if (raw.HasValue && !raw.IsNullOrEmpty)
            {
                var json = raw.ToString();
                if (!string.IsNullOrEmpty(json))
                {
                    var cached = JsonSerializer.Deserialize<T>(json, JsonOptions);
                    if (cached is not null)
                        return cached;
                }
            }
        }
        catch (Exception)
        {
            // Deserialization or Redis read failed; treat as cache miss and run factory
        }

        var value = await factory(cancellationToken);
        try
        {
            var serialized = JsonSerializer.Serialize(value, JsonOptions);
            await _db.StringSetAsync(key, serialized, ttl, when: When.Always);
        }
        catch (Exception)
        {
            // Cache write failed; return value anyway
        }
        return value;
    }

    public Task InvalidateAsync(string key, CancellationToken cancellationToken = default)
    {
        return _db.KeyDeleteAsync(key);
    }
}

public sealed class NoOpRateLimitService : IRateLimitService
{
    public Task<bool> AllowAsync(string scope, string key, int limit, int windowSeconds, CancellationToken cancellationToken = default) => Task.FromResult(true);
}

public sealed class RedisRateLimitService : IRateLimitService
{
    private const string KeyPrefix = "ratelimit:";
    private readonly IConnectionMultiplexer _redis;

    public RedisRateLimitService(IConnectionMultiplexer redis) => _redis = redis;

    public async Task<bool> AllowAsync(string scope, string key, int limit, int windowSeconds, CancellationToken cancellationToken = default)
    {
        var rkey = $"{KeyPrefix}{scope}:{key}";
        var db = _redis.GetDatabase();
        var count = (long)await db.StringIncrementAsync(rkey);
        if (count == 1)
            await db.KeyExpireAsync(rkey, TimeSpan.FromSeconds(windowSeconds));
        return count <= limit;
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

public sealed class WorkspaceDeleteService : IWorkspaceDeleteService
{
    private readonly ApplicationDbContext _db;
    private readonly IStorageService _storage;
    private readonly ICacheService _cache;
    private readonly ILogger<WorkspaceDeleteService> _logger;

    public WorkspaceDeleteService(ApplicationDbContext db, IStorageService storage, ICacheService cache, ILogger<WorkspaceDeleteService> logger)
    {
        _db = db;
        _storage = storage;
        _cache = cache;
        _logger = logger;
    }

    public async Task DeleteWorkspaceAsync(Guid workspaceId, Guid tenantId, CancellationToken cancellationToken = default)
    {
        var workspace = await _db.Workspaces.FirstOrDefaultAsync(w => w.Id == workspaceId && w.TenantId == tenantId, cancellationToken);
        if (workspace == null)
        {
            _logger.LogWarning("Workspace delete failed: not found. WorkspaceId={WorkspaceId}, TenantId={TenantId}", workspaceId, tenantId);
            throw new InvalidOperationException("Workspace not found or access denied.");
        }

        var strategy = _db.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async ct =>
        {
            await using var transaction = await _db.Database.BeginTransactionAsync(ct);
            try
            {
                var documents = await _db.Documents.Where(d => d.WorkspaceId == workspaceId).ToListAsync(ct);
                foreach (var doc in documents)
                {
                    try
                    {
                        await _storage.DeleteObjectAsync(doc.StoragePath, ct);
                        _logger.LogInformation("Deleted storage file for document {DocumentId}", doc.Id);
                    }
                    catch (Exception ex) { _logger.LogWarning(ex, "Failed to delete storage file {StoragePath}", doc.StoragePath); }
                }
                var questions = await _db.Questions.Where(q => q.WorkspaceId == workspaceId).ToListAsync(ct);
                _db.Answers.RemoveRange(_db.Answers.Where(a => questions.Select(q => q.Id).Contains(a.QuestionId)));
                _db.Questions.RemoveRange(questions);
                _db.Documents.RemoveRange(documents);
                _db.Workspaces.Remove(workspace);
                await _db.SaveChangesAsync(ct);
                await transaction.CommitAsync(ct);

                await _cache.InvalidateAsync($"workspaces:tenant:{tenantId:N}", ct);
                _logger.LogInformation("Deleted workspace {WorkspaceId} for tenant {TenantId}", workspaceId, tenantId);
            }
            catch { await transaction.RollbackAsync(ct); throw; }
        }, cancellationToken);
    }
}

public sealed class DocumentDeleteService : IDocumentDeleteService
{
    private readonly ApplicationDbContext _db;
    private readonly IStorageService _storage;
    private readonly ICacheService _cache;
    private readonly ILogger<DocumentDeleteService> _logger;

    public DocumentDeleteService(ApplicationDbContext db, IStorageService storage, ICacheService cache, ILogger<DocumentDeleteService> logger)
    {
        _db = db;
        _storage = storage;
        _cache = cache;
        _logger = logger;
    }

    public async Task DeleteDocumentAsync(Guid documentId, Guid tenantId, CancellationToken cancellationToken = default)
    {
        var document = await _db.Documents.FirstOrDefaultAsync(d => d.Id == documentId && d.TenantId == tenantId, cancellationToken);
        if (document == null)
        {
            _logger.LogWarning("Document delete failed: not found. DocumentId={DocumentId}, TenantId={TenantId}", documentId, tenantId);
            throw new InvalidOperationException("Document not found or access denied.");
        }

        var strategy = _db.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async ct =>
        {
            try
            {
                await _storage.DeleteObjectAsync(document.StoragePath, ct);
                _logger.LogInformation("Deleted storage file for document {DocumentId}", document.Id);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to delete storage file {StoragePath}", document.StoragePath);
            }

            _db.Documents.Remove(document);
            await _db.SaveChangesAsync(ct);

            await _cache.InvalidateAsync($"documents:tenant:{tenantId:N}:workspace:{document.WorkspaceId:N}", ct);
            _logger.LogInformation("Deleted document {DocumentId} from workspace {WorkspaceId}", documentId, document.WorkspaceId);
        }, cancellationToken);
    }
}

public sealed class TenantDeleteService : ITenantDeleteService
{
    private readonly ApplicationDbContext _db;
    private readonly IStorageService _storage;
    private readonly ILogger<TenantDeleteService> _logger;

    public TenantDeleteService(ApplicationDbContext db, IStorageService storage, ILogger<TenantDeleteService> logger)
    {
        _db = db;
        _storage = storage;
        _logger = logger;
    }

    public async Task DeleteTenantAsync(Guid tenantId, CancellationToken cancellationToken = default)
    {
        var tenant = await _db.Tenants.FirstOrDefaultAsync(t => t.Id == tenantId, cancellationToken);
        if (tenant == null) throw new InvalidOperationException("Tenant not found.");

        var strategy = _db.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async ct =>
        {
            await using var transaction = await _db.Database.BeginTransactionAsync(ct);
            try
            {
                var documents = await _db.Documents.Where(d => d.TenantId == tenantId).ToListAsync(ct);
                var workspaceIds = (await _db.Workspaces.Where(w => w.TenantId == tenantId).Select(w => w.Id).ToListAsync(ct)).ToHashSet();

                foreach (var doc in documents)
                {
                    try { await _storage.DeleteObjectAsync(doc.StoragePath, ct); }
                    catch (Exception ex) { _logger.LogWarning(ex, "Failed to delete storage file {StoragePath}", doc.StoragePath); }
                }
                var questions = await _db.Questions.Where(q => workspaceIds.Contains(q.WorkspaceId)).ToListAsync(ct);
                _db.Answers.RemoveRange(_db.Answers.Where(a => questions.Select(q => q.Id).Contains(a.QuestionId)));
                _db.Questions.RemoveRange(questions);
                _db.Documents.RemoveRange(documents);
                _db.Workspaces.RemoveRange(_db.Workspaces.Where(w => w.TenantId == tenantId));
                _db.TenantInvites.RemoveRange(_db.TenantInvites.Where(i => i.TenantId == tenantId));
                _db.Users.RemoveRange(_db.Users.Where(u => u.TenantId == tenantId));
                _db.Tenants.Remove(tenant);
                await _db.SaveChangesAsync(ct);
                await transaction.CommitAsync(ct);
                _logger.LogInformation("Deleted tenant {TenantId}", tenantId);
            }
            catch { await transaction.RollbackAsync(ct); throw; }
        }, cancellationToken);
    }
}

public sealed class TenantOverviewProvider : ITenantOverviewProvider
{
    private readonly ApplicationDbContext _db;

    public TenantOverviewProvider(ApplicationDbContext db)
    {
        _db = db;
    }

    public async Task<TenantOverviewDto> GetOverviewAsync(Guid tenantId, CancellationToken cancellationToken = default)
    {
        var totalDocuments = await _db.Documents.CountAsync(d => d.TenantId == tenantId, cancellationToken);
        var totalQuestions = await _db.Questions.CountAsync(q => q.TenantId == tenantId, cancellationToken);
        var totalUsers = await _db.Users.CountAsync(u => u.TenantId == tenantId, cancellationToken);

        var docCountPerWorkspace = await _db.Documents
            .Where(d => d.TenantId == tenantId)
            .GroupBy(d => new { d.WorkspaceId })
            .Select(g => new { g.Key.WorkspaceId, Count = g.Count() })
            .ToListAsync(cancellationToken);

        var workspaceIds = docCountPerWorkspace.Select(x => x.WorkspaceId).Distinct().ToList();
        var workspaceNames = await _db.Workspaces
            .Where(w => workspaceIds.Contains(w.Id))
            .ToDictionaryAsync(w => w.Id, w => w.Name, cancellationToken);

        var docCountPerWorkspaceDtos = docCountPerWorkspace
            .Select(x => new DocCountPerWorkspaceDto(x.WorkspaceId, workspaceNames.GetValueOrDefault(x.WorkspaceId, "?"), x.Count))
            .ToList()
            .AsReadOnly();

        var thirtyDaysAgo = DateTime.UtcNow.Date.AddDays(-30);
        var questionsInRange = await _db.Questions
            .Where(q => q.TenantId == tenantId && q.CreatedAt >= thirtyDaysAgo)
            .Select(q => q.CreatedAt)
            .ToListAsync(cancellationToken);

        var questionsByDay = questionsInRange
            .GroupBy(d => d.Date)
            .OrderBy(g => g.Key)
            .Select(g => new QuestionsPerDayDto(g.Key, g.Count()))
            .ToList()
            .AsReadOnly();

        var questionIds = await _db.Questions.Where(q => q.TenantId == tenantId).Select(q => q.Id).ToListAsync(cancellationToken);
        var answers = await _db.Answers.Where(a => questionIds.Contains(a.QuestionId)).ToListAsync(cancellationToken);

        double? averageLatencyMs = answers.Count > 0 ? answers.Average(a => a.LatencyMs) : null;

        var documentUsageCounts = new Dictionary<Guid, int>();
        foreach (var answer in answers)
        {
            if (string.IsNullOrEmpty(answer.SourcesJson)) continue;
            try
            {
                var sources = System.Text.Json.JsonSerializer.Deserialize<List<SourceItem>>(answer.SourcesJson);
                if (sources == null) continue;
                foreach (var s in sources)
                {
                    documentUsageCounts.TryGetValue(s.DocumentId, out var c);
                    documentUsageCounts[s.DocumentId] = c + 1;
                }
            }
            catch { /* ignore parse errors */ }
        }

        var topDocIds = documentUsageCounts.OrderByDescending(kv => kv.Value).Take(10).Select(kv => kv.Key).ToList();
        var docNames = await _db.Documents.Where(d => topDocIds.Contains(d.Id)).ToDictionaryAsync(d => d.Id, d => d.FileName, cancellationToken);

        var topDocumentsByUsage = documentUsageCounts
            .OrderByDescending(kv => kv.Value)
            .Take(10)
            .Select(kv => new TopDocumentUsageDto(kv.Key, docNames.GetValueOrDefault(kv.Key, "?"), kv.Value))
            .ToList()
            .AsReadOnly();

        return new TenantOverviewDto(
            totalDocuments,
            totalQuestions,
            totalUsers,
            averageLatencyMs,
            docCountPerWorkspaceDtos,
            questionsByDay,
            topDocumentsByUsage);
    }

    private sealed class SourceItem
    {
        public Guid DocumentId { get; set; }
        public string? FileName { get; set; }
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
                    // 1200 chars + 200 overlap: keeps full Experience entries together for better entity recall
                    var pageChunks = SplitTextIntoChunks(normalized, 1200, 200);
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

    /// <summary>
    /// Splits text into chunks while preserving logical section boundaries.
    /// Uses section-aware splitting for reliable recall across all document types:
    /// contracts, reports, invoices, manuals, research papers, resumes, and more.
    /// </summary>
    private static IReadOnlyList<string> SplitTextIntoChunks(string text, int chunkSize, int overlap)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return [];
        }

        // Normalize: collapse multiple spaces/newlines but preserve paragraph breaks
        var normalized = string.Join('\n', text
            .Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .Select(l => string.Join(' ', l.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)).Trim())
            .Where(l => l.Length > 0));

        if (normalized.Length <= chunkSize)
        {
            return [normalized];
        }

        // Section headers across document types: legal, reports, manuals, invoices, resumes, etc.
        var sectionHeaders = new[]
        {
            "article", "section", "chapter", "clause", "appendix", "attachment", "schedule",
            "experience", "employment", "work", "work experience", "professional experience", "career",
            "introduction", "summary", "conclusion", "references", "methodology", "findings",
            "terms", "conditions", "definitions", "obligations", "parties", "whereas",
            "procedure", "steps", "instructions", "specifications", "requirements",
            "item", "line item", "description", "amount", "total", "subtotal",
            "تعليم", "خبرة", "الخبرة", "الوظائف", "المادة", "الفقرة", "الفصل"
        };
        var lines = normalized.Split('\n');

        // Build semantic blocks: merge consecutive lines, split at section boundaries
        var blocks = new List<string>();
        var currentBlock = new List<string>();

        foreach (var line in lines)
        {
            var trimmed = line.Trim();
            if (string.IsNullOrWhiteSpace(trimmed))
                continue;

            // Numbered sections (1., 1.1, I., Article 1, etc.) common in legal, reports, manuals
            var isNumberedSection = System.Text.RegularExpressions.Regex.IsMatch(
                trimmed, @"^(?:\d+\.(?:\d+\.)*|\d+\)|\(?\d+\)|I{1,3}\.|IV\.?|V\.?)\s*\S");

            var isNewSection = isNumberedSection || sectionHeaders.Any(h =>
                trimmed.StartsWith(h, StringComparison.OrdinalIgnoreCase) ||
                (trimmed.Length <= 35 && trimmed.Contains(h, StringComparison.OrdinalIgnoreCase)));

            if (isNewSection && currentBlock.Count > 0)
            {
                var blockText = string.Join("\n", currentBlock).Trim();
                if (blockText.Length > 0)
                    blocks.Add(blockText);
                currentBlock = [trimmed];
            }
            else
            {
                currentBlock.Add(trimmed);
            }
        }

        if (currentBlock.Count > 0)
        {
            var blockText = string.Join("\n", currentBlock).Trim();
            if (blockText.Length > 0)
                blocks.Add(blockText);
        }

        // If no section structure detected, fall back to paragraph-level split
        if (blocks.Count <= 1)
        {
            blocks = normalized
                .Split(new[] { "\n\n", "\n" }, StringSplitOptions.RemoveEmptyEntries)
                .Select(s => s.Trim())
                .Where(s => s.Length > 0)
                .ToList();
        }

        // Merge blocks into chunks of desired size, never splitting within a block if it fits
        var chunks = new List<string>();
        var chunkBuffer = new List<string>();
        var chunkLen = 0;

        foreach (var block in blocks)
        {
            var blockLen = block.Length + (chunkBuffer.Count > 0 ? 2 : 0); // +2 for \n\n

            if (chunkLen + blockLen <= chunkSize)
            {
                chunkBuffer.Add(block);
                chunkLen += blockLen;
            }
            else
            {
                if (chunkBuffer.Count > 0)
                {
                    chunks.Add(string.Join("\n\n", chunkBuffer));
                    chunkBuffer.Clear();
                    chunkLen = 0;
                }

                if (block.Length <= chunkSize)
                {
                    chunkBuffer.Add(block);
                    chunkLen = block.Length;
                }
                else
                {
                    // Block too large: use sliding window with overlap
                    var subChunks = SplitBySlidingWindow(block, chunkSize, overlap);
                    chunks.AddRange(subChunks);
                }
            }
        }

        if (chunkBuffer.Count > 0)
            chunks.Add(string.Join("\n\n", chunkBuffer));

        return chunks;
    }

    /// <summary>Fallback: sliding window split when a block exceeds chunk size.</summary>
    private static IReadOnlyList<string> SplitBySlidingWindow(string text, int chunkSize, int overlap)
    {
        if (text.Length <= chunkSize)
            return [text];

        var result = new List<string>();
        var step = Math.Max(1, chunkSize - overlap);
        var start = 0;

        while (start < text.Length)
        {
            var len = Math.Min(chunkSize, text.Length - start);
            var end = start + len;
            if (end < text.Length)
            {
                var lastSpace = text.LastIndexOf(' ', end - 1, len);
                if (lastSpace > start + (chunkSize / 2))
                    end = lastSpace;
            }

            var chunk = text[start..end].Trim();
            if (!string.IsNullOrWhiteSpace(chunk))
                result.Add(chunk);

            if (end >= text.Length)
                break;

            start = Math.Max(0, end - overlap);
        }

        return result;
    }
}
