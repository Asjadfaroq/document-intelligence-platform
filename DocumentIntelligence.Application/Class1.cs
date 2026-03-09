using DocumentIntelligence.Domain;
using MediatR;

namespace DocumentIntelligence.Application;

public record RegisterTenantAndOwnerCommand(
    string TenantName,
    string TenantSlug,
    string OwnerEmail,
    string OwnerPassword
) : IRequest<AuthResult>;

public record LoginCommand(
    string Email,
    string Password,
    string TenantSlug
) : IRequest<AuthResult>;

public record RefreshCommand(string RefreshToken) : IRequest<AuthResult>;

public record AuthResult(
    string AccessToken,
    string TenantId,
    string Email,
    string Role,
    string? RefreshToken = null,
    DateTime? ExpiresAtUtc = null
);

public record WorkspaceDto(
    Guid Id,
    string Name,
    string? Description,
    DateTime CreatedAt
);

public record DocumentDto(
    Guid Id,
    Guid WorkspaceId,
    string FileName,
    string StoragePath,
    string? Language,
    DocumentStatus Status,
    DateTime CreatedAt
);

public interface IPasswordHasher
{
    string Hash(string password);
    bool Verify(string password, string hash);
}

public interface IJwtTokenGenerator
{
    string GenerateToken(User user);
    TimeSpan GetAccessTokenLifespan();
}

public interface IRefreshTokenStore
{
    Task<(string Token, DateTime ExpiresAtUtc)> CreateAsync(Guid userId, CancellationToken cancellationToken = default);
    Task<User?> GetUserByTokenAsync(string token, CancellationToken cancellationToken = default);
    Task RevokeAsync(string token, CancellationToken cancellationToken = default);
}

public interface IStorageService
{
    Task<string> UploadDocumentAsync(
        Guid tenantId,
        Guid workspaceId,
        string fileName,
        Stream content,
        CancellationToken cancellationToken);
}

public interface IEmbeddingService
{
    Task<float[]> GetEmbeddingAsync(string text, CancellationToken cancellationToken);
}

public interface ILLMClient
{
    Task<string> GenerateAnswerAsync(string question, string context, string? languageHint, CancellationToken cancellationToken);
}

public record DocumentIngestionMessage(Guid DocumentId, Guid TenantId);

public interface IIngestionQueue
{
    Task EnqueueAsync(DocumentIngestionMessage message, CancellationToken cancellationToken);
}

/// <summary>In-memory or distributed cache for workspace/document lists and other frequently accessed data.</summary>
public interface ICacheService
{
    Task<T> GetOrSetAsync<T>(string key, TimeSpan ttl, Func<CancellationToken, Task<T>> factory, CancellationToken cancellationToken = default);
    Task InvalidateAsync(string key, CancellationToken cancellationToken = default);
}

/// <summary>Rate limiting (e.g. Redis-backed). Returns true if the request is allowed, false if rate limited.</summary>
public interface IRateLimitService
{
    Task<bool> AllowAsync(string scope, string key, int limit, int windowSeconds, CancellationToken cancellationToken = default);
}

/// <summary>Validates that a workspace exists and belongs to the given tenant. Used for workspace-scoped authorization.</summary>
public interface IWorkspaceAccessService
{
    Task<bool> WorkspaceBelongsToTenantAsync(Guid workspaceId, Guid tenantId, CancellationToken cancellationToken = default);
}

/// <summary>Admin tenant overview stats for the dashboard.</summary>
public record TenantOverviewDto(
    int TotalDocuments,
    int TotalQuestions,
    int TotalUsers,
    double? AverageAnswerLatencyMs,
    IReadOnlyList<DocCountPerWorkspaceDto> DocCountPerWorkspace,
    IReadOnlyList<QuestionsPerDayDto> QuestionsPerDay,
    IReadOnlyList<TopDocumentUsageDto> TopDocumentsByUsage);

public record DocCountPerWorkspaceDto(Guid WorkspaceId, string WorkspaceName, int DocumentCount);
public record QuestionsPerDayDto(DateTime Date, int Count);
public record TopDocumentUsageDto(Guid DocumentId, string FileName, int UsageCount);

public interface ITenantOverviewProvider
{
    Task<TenantOverviewDto> GetOverviewAsync(Guid tenantId, CancellationToken cancellationToken = default);
}

public interface IApplicationDbContext
{
    IQueryable<Tenant> Tenants { get; }
    IQueryable<User> Users { get; }
    IQueryable<Workspace> Workspaces { get; }
    IQueryable<Document> Documents { get; }
    IQueryable<TenantInvite> TenantInvites { get; }

    Task AddAsync<TEntity>(TEntity entity, CancellationToken cancellationToken)
        where TEntity : class;

    Task<int> SaveChangesAsync(CancellationToken cancellationToken);
}

public record TenantMemberDto(
    Guid Id,
    string Email,
    UserRole Role,
    DateTime CreatedAt);

public record GetTenantMembersQuery(Guid TenantId) : IRequest<IReadOnlyList<TenantMemberDto>>;

public record CreateTenantInviteCommand(
    Guid TenantId,
    string Email,
    UserRole Role) : IRequest<string>; // returns invite code

public record AcceptInviteCommand(
    string Code,
    string Password) : IRequest<AuthResult>;

public record TenantMembershipDto(
    Guid TenantId,
    string TenantName,
    string TenantSlug,
    string Role);

public record GetUserTenantsQuery(string Email) : IRequest<IReadOnlyList<TenantMembershipDto>>;

public record SwitchTenantCommand(
    Guid TenantId,
    string Email) : IRequest<AuthResult>;

public record GetWorkspacesQuery(Guid TenantId) : IRequest<IReadOnlyList<WorkspaceDto>>;

public record CreateWorkspaceCommand(Guid TenantId, string Name, string? Description) : IRequest<WorkspaceDto>;

public record GetDocumentsQuery(Guid TenantId, Guid WorkspaceId) : IRequest<IReadOnlyList<DocumentDto>>;

public record CreateDocumentCommand(
    Guid TenantId,
    Guid WorkspaceId,
    string FileName,
    string StoragePath,
    string? Language
) : IRequest<DocumentDto>;

public record UploadDocumentCommand(
    Guid TenantId,
    Guid WorkspaceId,
    string FileName,
    Stream Content,
    string? Language
) : IRequest<DocumentDto>;

public record AskRequest(
    Guid WorkspaceId,
    string Question,
    int TopK,
    string? Mode
);

public record AskResponse(
    string Answer,
    IReadOnlyList<DocumentDto> Sources,
    int LatencyMs
);

public enum AskSearchMode
{
    Vector = 1,
    Hybrid = 2
}

public record AskQuestionCommand(
    Guid TenantId,
    Guid WorkspaceId,
    Guid UserId,
    string Question,
    int TopK,
    AskSearchMode Mode,
    string? LanguageHint
) : IRequest<AskResponse>;

public record RetrievalChunkDto(Guid ChunkId, string Content, Guid DocumentId, string FileName);

public interface IVectorSearchService
{
    Task<IReadOnlyList<RetrievalChunkDto>> SearchChunksAsync(
        Guid tenantId,
        Guid workspaceId,
        float[] queryEmbedding,
        string question,
        AskSearchMode mode,
        int topK,
        CancellationToken cancellationToken);
}

public class RegisterTenantAndOwnerCommandHandler : IRequestHandler<RegisterTenantAndOwnerCommand, AuthResult>
{
    private readonly IApplicationDbContext _db;
    private readonly IPasswordHasher _passwordHasher;
    private readonly IJwtTokenGenerator _jwt;
    private readonly IRefreshTokenStore _refreshTokenStore;

    public RegisterTenantAndOwnerCommandHandler(
        IApplicationDbContext db,
        IPasswordHasher passwordHasher,
        IJwtTokenGenerator jwt,
        IRefreshTokenStore refreshTokenStore)
    {
        _db = db;
        _passwordHasher = passwordHasher;
        _jwt = jwt;
        _refreshTokenStore = refreshTokenStore;
    }

    public async Task<AuthResult> Handle(RegisterTenantAndOwnerCommand request, CancellationToken cancellationToken)
    {
        var tenant = new Tenant
        {
            Id = Guid.NewGuid(),
            Name = request.TenantName,
            Slug = request.TenantSlug,
            CreatedAt = DateTime.UtcNow
        };

        var owner = new User
        {
            Id = Guid.NewGuid(),
            Email = request.OwnerEmail.ToLowerInvariant(),
            PasswordHash = _passwordHasher.Hash(request.OwnerPassword),
            Role = UserRole.Owner,
            TenantId = tenant.Id,
            CreatedAt = DateTime.UtcNow
        };

        var defaultWorkspace = new Workspace
        {
            Id = Guid.NewGuid(),
            Name = "Default Workspace",
            Description = "Default workspace",
            TenantId = tenant.Id,
            CreatedAt = DateTime.UtcNow
        };

        await _db.AddAsync(tenant, cancellationToken);
        await _db.AddAsync(owner, cancellationToken);
        await _db.AddAsync(defaultWorkspace, cancellationToken);

        await _db.SaveChangesAsync(cancellationToken);

        var accessToken = _jwt.GenerateToken(owner);
        var lifespan = _jwt.GetAccessTokenLifespan();
        var (refreshToken, _) = await _refreshTokenStore.CreateAsync(owner.Id, cancellationToken);

        return new AuthResult(
            accessToken,
            tenant.Id.ToString(),
            owner.Email,
            owner.Role.ToString(),
            refreshToken,
            DateTime.UtcNow.Add(lifespan));
    }
}

public class LoginCommandHandler : IRequestHandler<LoginCommand, AuthResult>
{
    private readonly IApplicationDbContext _db;
    private readonly IPasswordHasher _passwordHasher;
    private readonly IJwtTokenGenerator _jwt;
    private readonly IRefreshTokenStore _refreshTokenStore;

    public LoginCommandHandler(
        IApplicationDbContext db,
        IPasswordHasher passwordHasher,
        IJwtTokenGenerator jwt,
        IRefreshTokenStore refreshTokenStore)
    {
        _db = db;
        _passwordHasher = passwordHasher;
        _jwt = jwt;
        _refreshTokenStore = refreshTokenStore;
    }

    public async Task<AuthResult> Handle(LoginCommand request, CancellationToken cancellationToken)
    {
        var tenant = _db.Tenants.FirstOrDefault(t => t.Slug == request.TenantSlug);
        if (tenant is null)
            throw new UnauthorizedAccessException("Invalid credentials.");

        var email = request.Email.ToLowerInvariant();
        var user = _db.Users.FirstOrDefault(u => u.TenantId == tenant.Id && u.Email == email);
        if (user is null || !_passwordHasher.Verify(request.Password, user.PasswordHash))
            throw new UnauthorizedAccessException("Invalid credentials.");

        var accessToken = _jwt.GenerateToken(user);
        var lifespan = _jwt.GetAccessTokenLifespan();
        var (refreshToken, refreshExpiresAt) = await _refreshTokenStore.CreateAsync(user.Id, cancellationToken);

        return new AuthResult(
            accessToken,
            tenant.Id.ToString(),
            user.Email,
            user.Role.ToString(),
            refreshToken,
            DateTime.UtcNow.Add(lifespan));
    }
}

public class RefreshCommandHandler : IRequestHandler<RefreshCommand, AuthResult>
{
    private readonly IRefreshTokenStore _refreshTokenStore;
    private readonly IJwtTokenGenerator _jwt;

    public RefreshCommandHandler(IRefreshTokenStore refreshTokenStore, IJwtTokenGenerator jwt)
    {
        _refreshTokenStore = refreshTokenStore;
        _jwt = jwt;
    }

    public async Task<AuthResult> Handle(RefreshCommand request, CancellationToken cancellationToken)
    {
        var user = await _refreshTokenStore.GetUserByTokenAsync(request.RefreshToken, cancellationToken);
        if (user is null)
            throw new UnauthorizedAccessException("Invalid or expired refresh token.");

        await _refreshTokenStore.RevokeAsync(request.RefreshToken, cancellationToken);
        var (newRefreshToken, _) = await _refreshTokenStore.CreateAsync(user.Id, cancellationToken);

        var accessToken = _jwt.GenerateToken(user);
        var expiresAtUtc = DateTime.UtcNow.Add(_jwt.GetAccessTokenLifespan());

        return new AuthResult(
            accessToken,
            user.TenantId.ToString(),
            user.Email,
            user.Role.ToString(),
            newRefreshToken,
            expiresAtUtc);
    }
}

public class GetWorkspacesQueryHandler : IRequestHandler<GetWorkspacesQuery, IReadOnlyList<WorkspaceDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICacheService _cache;

    private static readonly TimeSpan WorkspacesCacheTtl = TimeSpan.FromSeconds(60);

    public GetWorkspacesQueryHandler(IApplicationDbContext db, ICacheService cache)
    {
        _db = db;
        _cache = cache;
    }

    public async Task<IReadOnlyList<WorkspaceDto>> Handle(GetWorkspacesQuery request, CancellationToken cancellationToken)
    {
        var key = $"workspaces:tenant:{request.TenantId:N}";
        return await _cache.GetOrSetAsync(key, WorkspacesCacheTtl, async ct =>
        {
            var list = _db.Workspaces
                .Where(w => w.TenantId == request.TenantId)
                .OrderBy(w => w.CreatedAt)
                .Select(w => new WorkspaceDto(w.Id, w.Name, w.Description, w.CreatedAt))
                .ToList()
                .AsReadOnly();
            return await Task.FromResult(list);
        }, cancellationToken);
    }
}

public class CreateWorkspaceCommandHandler : IRequestHandler<CreateWorkspaceCommand, WorkspaceDto>
{
    private readonly IApplicationDbContext _db;
    private readonly ICacheService _cache;

    public CreateWorkspaceCommandHandler(IApplicationDbContext db, ICacheService cache)
    {
        _db = db;
        _cache = cache;
    }

    public async Task<WorkspaceDto> Handle(CreateWorkspaceCommand request, CancellationToken cancellationToken)
    {
        var workspace = new Workspace
        {
            Id = Guid.NewGuid(),
            TenantId = request.TenantId,
            Name = request.Name,
            Description = request.Description,
            CreatedAt = DateTime.UtcNow
        };

        await _db.AddAsync(workspace, cancellationToken);
        await _db.SaveChangesAsync(cancellationToken);

        await _cache.InvalidateAsync($"workspaces:tenant:{request.TenantId:N}", cancellationToken);

        return new WorkspaceDto(workspace.Id, workspace.Name, workspace.Description, workspace.CreatedAt);
    }
}

public class GetDocumentsQueryHandler : IRequestHandler<GetDocumentsQuery, IReadOnlyList<DocumentDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICacheService _cache;

    private static readonly TimeSpan DocumentsCacheTtl = TimeSpan.FromSeconds(60);

    public GetDocumentsQueryHandler(IApplicationDbContext db, ICacheService cache)
    {
        _db = db;
        _cache = cache;
    }

    public async Task<IReadOnlyList<DocumentDto>> Handle(GetDocumentsQuery request, CancellationToken cancellationToken)
    {
        var key = $"documents:tenant:{request.TenantId:N}:workspace:{request.WorkspaceId:N}";
        return await _cache.GetOrSetAsync(key, DocumentsCacheTtl, async ct =>
        {
            var list = _db.Documents
                .Where(d => d.TenantId == request.TenantId && d.WorkspaceId == request.WorkspaceId)
                .OrderByDescending(d => d.CreatedAt)
                .Select(d => new DocumentDto(
                    d.Id,
                    d.WorkspaceId,
                    d.FileName,
                    d.StoragePath,
                    d.Language,
                    d.Status,
                    d.CreatedAt))
                .ToList()
                .AsReadOnly();
            return await Task.FromResult(list);
        }, cancellationToken);
    }
}

public class CreateDocumentCommandHandler : IRequestHandler<CreateDocumentCommand, DocumentDto>
{
    private readonly IApplicationDbContext _db;

    public CreateDocumentCommandHandler(IApplicationDbContext db)
    {
        _db = db;
    }

    public async Task<DocumentDto> Handle(CreateDocumentCommand request, CancellationToken cancellationToken)
    {
        var document = new Document
        {
            Id = Guid.NewGuid(),
            TenantId = request.TenantId,
            WorkspaceId = request.WorkspaceId,
            FileName = request.FileName,
            StoragePath = request.StoragePath,
            Language = request.Language,
            Status = DocumentStatus.Uploaded,
            CreatedAt = DateTime.UtcNow
        };

        await _db.AddAsync(document, cancellationToken);
        await _db.SaveChangesAsync(cancellationToken);

        return new DocumentDto(
            document.Id,
            document.WorkspaceId,
            document.FileName,
            document.StoragePath,
            document.Language,
            document.Status,
            document.CreatedAt);
    }
}

public class UploadDocumentCommandHandler : IRequestHandler<UploadDocumentCommand, DocumentDto>
{
    private readonly IApplicationDbContext _db;
    private readonly IStorageService _storage;
    private readonly IIngestionQueue _queue;
    private readonly ICacheService _cache;

    public UploadDocumentCommandHandler(
        IApplicationDbContext db,
        IStorageService storage,
        IIngestionQueue queue,
        ICacheService cache)
    {
        _db = db;
        _storage = storage;
        _queue = queue;
        _cache = cache;
    }

    public async Task<DocumentDto> Handle(UploadDocumentCommand request, CancellationToken cancellationToken)
    {
        var storagePath = await _storage.UploadDocumentAsync(
            request.TenantId,
            request.WorkspaceId,
            request.FileName,
            request.Content,
            cancellationToken);

        var document = new Document
        {
            Id = Guid.NewGuid(),
            TenantId = request.TenantId,
            WorkspaceId = request.WorkspaceId,
            FileName = request.FileName,
            StoragePath = storagePath,
            Language = request.Language,
            Status = DocumentStatus.Uploaded,
            CreatedAt = DateTime.UtcNow
        };

        await _db.AddAsync(document, cancellationToken);
        await _db.SaveChangesAsync(cancellationToken);

        await _cache.InvalidateAsync($"documents:tenant:{request.TenantId:N}:workspace:{request.WorkspaceId:N}", cancellationToken);
        await _queue.EnqueueAsync(new DocumentIngestionMessage(document.Id, document.TenantId), cancellationToken);

        return new DocumentDto(
            document.Id,
            document.WorkspaceId,
            document.FileName,
            document.StoragePath,
            document.Language,
            document.Status,
            document.CreatedAt);
    }
}

public class AskQuestionCommandHandler : IRequestHandler<AskQuestionCommand, AskResponse>
{
    private readonly IApplicationDbContext _db;
    private readonly IEmbeddingService _embeddings;
    private readonly ILLMClient _llm;
    private readonly IVectorSearchService _vectorSearch;

    public AskQuestionCommandHandler(
        IApplicationDbContext db,
        IEmbeddingService embeddings,
        ILLMClient llm,
        IVectorSearchService vectorSearch)
    {
        _db = db;
        _embeddings = embeddings;
        _llm = llm;
        _vectorSearch = vectorSearch;
    }

    public async Task<AskResponse> Handle(AskQuestionCommand request, CancellationToken cancellationToken)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var questionEmbedding = await _embeddings.GetEmbeddingAsync(request.Question, cancellationToken);

        var topK = request.TopK <= 0 ? 5 : Math.Min(request.TopK, 10);
        var chunks = await _vectorSearch.SearchChunksAsync(
            request.TenantId,
            request.WorkspaceId,
            questionEmbedding,
            request.Question,
            request.Mode,
            topK,
            cancellationToken);

        var contextText = chunks.Count > 0
            ? string.Join("\n\n---\n\n", chunks.Select(c => $"[{c.FileName}]\n{c.Content}"))
            : "No relevant documents found.";

        var answerText = await _llm.GenerateAnswerAsync(request.Question, contextText, request.LanguageHint, cancellationToken);
        sw.Stop();

        var documentIds = chunks.Select(c => c.DocumentId).Distinct().ToList();
        var docs = _db.Documents
            .Where(d => documentIds.Contains(d.Id))
            .Select(d => new DocumentDto(
                d.Id,
                d.WorkspaceId,
                d.FileName,
                d.StoragePath,
                d.Language,
                d.Status,
                d.CreatedAt))
            .ToList()
            .AsReadOnly();

        var question = new Question
        {
            Id = Guid.NewGuid(),
            TenantId = request.TenantId,
            WorkspaceId = request.WorkspaceId,
            UserId = request.UserId,
            QuestionText = request.Question,
            CreatedAt = DateTime.UtcNow
        };
        await _db.AddAsync(question, cancellationToken);
        await _db.SaveChangesAsync(cancellationToken);

        var answer = new Answer
        {
            Id = Guid.NewGuid(),
            QuestionId = question.Id,
            AnswerText = answerText,
            SourcesJson = System.Text.Json.JsonSerializer.Serialize(chunks.Select(c => new { c.ChunkId, c.DocumentId, c.FileName }).ToList()),
            LatencyMs = (int)sw.ElapsedMilliseconds,
            ModelName = null
        };
        await _db.AddAsync(answer, cancellationToken);
        await _db.SaveChangesAsync(cancellationToken);

        return new AskResponse(answerText, docs, (int)sw.ElapsedMilliseconds);
    }
}

public class GetTenantMembersQueryHandler : IRequestHandler<GetTenantMembersQuery, IReadOnlyList<TenantMemberDto>>
{
    private readonly IApplicationDbContext _db;

    public GetTenantMembersQueryHandler(IApplicationDbContext db)
    {
        _db = db;
    }

    public Task<IReadOnlyList<TenantMemberDto>> Handle(GetTenantMembersQuery request, CancellationToken cancellationToken)
    {
        var members = _db.Users
            .Where(u => u.TenantId == request.TenantId)
            .OrderBy(u => u.CreatedAt)
            .Select(u => new TenantMemberDto(u.Id, u.Email, u.Role, u.CreatedAt))
            .ToList()
            .AsReadOnly();

        return Task.FromResult<IReadOnlyList<TenantMemberDto>>(members);
    }
}

public class CreateTenantInviteCommandHandler : IRequestHandler<CreateTenantInviteCommand, string>
{
    private readonly IApplicationDbContext _db;

    public CreateTenantInviteCommandHandler(IApplicationDbContext db)
    {
        _db = db;
    }

    public async Task<string> Handle(CreateTenantInviteCommand request, CancellationToken cancellationToken)
    {
        var email = request.Email.Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(email))
            throw new ArgumentException("Email is required.", nameof(request.Email));

        var existingUser = _db.Users.FirstOrDefault(u => u.TenantId == request.TenantId && u.Email == email);
        if (existingUser is not null)
            throw new InvalidOperationException("User is already a member of this tenant.");

        var expiresAt = DateTime.UtcNow.AddDays(7);
        string code;

        // Simple unique code generator based on GUID; uniqueness enforced by DB index
        do
        {
            code = Convert.ToBase64String(Guid.NewGuid().ToByteArray())
                .Replace("+", string.Empty)
                .Replace("/", string.Empty)
                .Replace("=", string.Empty)
                .Substring(0, 22);
        } while (_db.TenantInvites.Any(i => i.Code == code));

        var invite = new TenantInvite
        {
            Id = Guid.NewGuid(),
            TenantId = request.TenantId,
            Email = email,
            Code = code,
            Role = request.Role,
            ExpiresAt = expiresAt,
            CreatedAt = DateTime.UtcNow,
            IsUsed = false
        };

        await _db.AddAsync(invite, cancellationToken);
        await _db.SaveChangesAsync(cancellationToken);

        return code;
    }
}

public class AcceptInviteCommandHandler : IRequestHandler<AcceptInviteCommand, AuthResult>
{
    private readonly IApplicationDbContext _db;
    private readonly IPasswordHasher _passwordHasher;
    private readonly IJwtTokenGenerator _jwt;
    private readonly IRefreshTokenStore _refreshTokenStore;

    public AcceptInviteCommandHandler(
        IApplicationDbContext db,
        IPasswordHasher passwordHasher,
        IJwtTokenGenerator jwt,
        IRefreshTokenStore refreshTokenStore)
    {
        _db = db;
        _passwordHasher = passwordHasher;
        _jwt = jwt;
        _refreshTokenStore = refreshTokenStore;
    }

    public async Task<AuthResult> Handle(AcceptInviteCommand request, CancellationToken cancellationToken)
    {
        var code = request.Code.Trim();
        if (string.IsNullOrWhiteSpace(code))
            throw new UnauthorizedAccessException("Invalid invite code.");

        var invite = _db.TenantInvites.FirstOrDefault(i => i.Code == code);
        if (invite is null || invite.IsUsed || invite.ExpiresAt <= DateTime.UtcNow)
            throw new UnauthorizedAccessException("Invite is invalid or expired.");

        var email = invite.Email.ToLowerInvariant();
        var existingUser = _db.Users.FirstOrDefault(u => u.TenantId == invite.TenantId && u.Email == email);
        if (existingUser is not null)
            throw new InvalidOperationException("User is already a member of this tenant.");

        var user = new User
        {
            Id = Guid.NewGuid(),
            Email = email,
            PasswordHash = _passwordHasher.Hash(request.Password),
            Role = invite.Role,
            TenantId = invite.TenantId,
            CreatedAt = DateTime.UtcNow
        };

        invite.IsUsed = true;

        await _db.AddAsync(user, cancellationToken);
        await _db.SaveChangesAsync(cancellationToken);

        var accessToken = _jwt.GenerateToken(user);
        var lifespan = _jwt.GetAccessTokenLifespan();
        var (refreshToken, _) = await _refreshTokenStore.CreateAsync(user.Id, cancellationToken);

        return new AuthResult(
            accessToken,
            invite.TenantId.ToString(),
            user.Email,
            user.Role.ToString(),
            refreshToken,
            DateTime.UtcNow.Add(lifespan));
    }
}

public class GetUserTenantsQueryHandler : IRequestHandler<GetUserTenantsQuery, IReadOnlyList<TenantMembershipDto>>
{
    private readonly IApplicationDbContext _db;

    public GetUserTenantsQueryHandler(IApplicationDbContext db)
    {
        _db = db;
    }

    public Task<IReadOnlyList<TenantMembershipDto>> Handle(GetUserTenantsQuery request, CancellationToken cancellationToken)
    {
        var email = request.Email.Trim().ToLowerInvariant();

        var memberships = (from u in _db.Users
                           join t in _db.Tenants on u.TenantId equals t.Id
                           where u.Email == email
                           orderby t.CreatedAt
                           select new TenantMembershipDto(
                               t.Id,
                               t.Name,
                               t.Slug,
                               u.Role.ToString()))
                          .ToList()
                          .AsReadOnly();

        return Task.FromResult<IReadOnlyList<TenantMembershipDto>>(memberships);
    }
}

public class SwitchTenantCommandHandler : IRequestHandler<SwitchTenantCommand, AuthResult>
{
    private readonly IApplicationDbContext _db;
    private readonly IJwtTokenGenerator _jwt;
    private readonly IRefreshTokenStore _refreshTokenStore;

    public SwitchTenantCommandHandler(
        IApplicationDbContext db,
        IJwtTokenGenerator jwt,
        IRefreshTokenStore refreshTokenStore)
    {
        _db = db;
        _jwt = jwt;
        _refreshTokenStore = refreshTokenStore;
    }

    public async Task<AuthResult> Handle(SwitchTenantCommand request, CancellationToken cancellationToken)
    {
        var email = request.Email.Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(email))
            throw new UnauthorizedAccessException("Invalid user.");

        var user = _db.Users.FirstOrDefault(u => u.Email == email && u.TenantId == request.TenantId);
        if (user is null)
            throw new UnauthorizedAccessException("User does not belong to the requested tenant.");

        var accessToken = _jwt.GenerateToken(user);
        var lifespan = _jwt.GetAccessTokenLifespan();
        var (refreshToken, _) = await _refreshTokenStore.CreateAsync(user.Id, cancellationToken);

        return new AuthResult(
            accessToken,
            user.TenantId.ToString(),
            user.Email,
            user.Role.ToString(),
            refreshToken,
            DateTime.UtcNow.Add(lifespan));
    }
}
