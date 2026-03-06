using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Channels;
using DocumentIntelligence.Application;
using DocumentIntelligence.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Pgvector;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
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

    public string GenerateToken(User user)
    {
        var secret = _configuration["Jwt:Secret"];
        if (string.IsNullOrWhiteSpace(secret))
        {
            throw new InvalidOperationException("JWT secret is not configured.");
        }

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

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
            expires: DateTime.UtcNow.AddHours(1),
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(token);
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

        var safeFileName = fileName.Replace(" ", "-");
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

    public async Task<string> GenerateAnswerAsync(string question, string context, CancellationToken cancellationToken)
    {
        var apiKey = SanitizeHfConfig(_configuration["HUGGINGFACE_API_KEY"]
            ?? throw new InvalidOperationException("HUGGINGFACE_API_KEY not set."));
        var model = SanitizeHfConfig(_configuration["HUGGINGFACE_LLM_MODEL"]
            ?? throw new InvalidOperationException("HUGGINGFACE_LLM_MODEL not set."));

        var prompt = $"Context:\n{context}\n\nQuestion:\n{question}\n\nAnswer:";

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
        int topK,
        CancellationToken cancellationToken)
    {
        var vector = new Vector(queryEmbedding);
        var results = await _db.Database
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

            var document = await db.Documents.FirstOrDefaultAsync(d => d.Id == message.DocumentId, stoppingToken);
            if (document is null)
            {
                continue;
            }

            document.Status = DocumentStatus.Processing;
            await db.SaveChangesAsync(stoppingToken);

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
                    var embedding = await embeddingService.GetEmbeddingAsync(normalized, stoppingToken);

                    var chunk = new DocumentChunk
                    {
                        Id = Guid.NewGuid(),
                        DocumentId = document.Id,
                        TenantId = document.TenantId,
                        PageNumber = page.Number,
                        ChunkIndex = chunkIndex++,
                        Content = normalized,
                        Embedding = embedding,
                        MetadataJson = null
                    };

                    chunks.Add(chunk);
                }

                if (chunks.Count > 0)
                {
                    await db.AddRangeAsync(chunks, stoppingToken);
                }

                document.Status = DocumentStatus.Ready;
                await db.SaveChangesAsync(stoppingToken);
            }
            catch
            {
                document.Status = DocumentStatus.Failed;
                await db.SaveChangesAsync(stoppingToken);
            }
        }
    }
}
