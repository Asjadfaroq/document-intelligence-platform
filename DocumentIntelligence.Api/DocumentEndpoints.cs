using System.Security.Claims;
using DocumentIntelligence.Application;
using MediatR;
using Microsoft.AspNetCore.Authorization;

namespace DocumentIntelligence.Api;

public record CreateDocumentRequest(
    Guid WorkspaceId,
    string FileName,
    string StoragePath,
    string? Language);
public record UploadDocumentResponse(DocumentDto Document);

public static class DocumentEndpoints
{
    public static IEndpointRouteBuilder MapDocuments(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/documents")
            .RequireAuthorization("TenantUser");

        group.MapGet("/workspaces/{workspaceId:guid}", async (
            Guid workspaceId,
            ClaimsPrincipal user,
            IMediator mediator,
            IWorkspaceAccessService workspaceAccessService,
            CancellationToken ct) =>
        {
            var tenantIdClaim = user.FindFirst("tenantId")?.Value;
            if (!Guid.TryParse(tenantIdClaim, out var tenantId))
            {
                return Results.Unauthorized();
            }

            if (!await workspaceAccessService.WorkspaceBelongsToTenantAsync(workspaceId, tenantId, ct))
            {
                return Results.Forbid();
            }

            var result = await mediator.Send(new GetDocumentsQuery(tenantId, workspaceId), ct);
            return Results.Ok(result);
        });

        group.MapPost(string.Empty, async (
            CreateDocumentRequest request,
            ClaimsPrincipal user,
            IMediator mediator,
            IWorkspaceAccessService workspaceAccessService,
            CancellationToken ct) =>
        {
            var tenantIdClaim = user.FindFirst("tenantId")?.Value;
            if (!Guid.TryParse(tenantIdClaim, out var tenantId))
            {
                return Results.Unauthorized();
            }

            if (!await workspaceAccessService.WorkspaceBelongsToTenantAsync(request.WorkspaceId, tenantId, ct))
            {
                return Results.Forbid();
            }

            var command = new CreateDocumentCommand(
                tenantId,
                request.WorkspaceId,
                request.FileName,
                request.StoragePath,
                request.Language);

            var created = await mediator.Send(command, ct);
            return Results.Ok(created);
        })
        ;

        group.MapPost("/upload", async (
            string workspaceId,
            IFormFile file,
            string? language,
            ClaimsPrincipal user,
            IMediator mediator,
            IWorkspaceAccessService workspaceAccessService,
            ILoggerFactory loggerFactory,
            CancellationToken ct) =>
        {
            var log = loggerFactory.CreateLogger("DocumentIntelligence.Documents");
            var tenantIdClaim = user.FindFirst("tenantId")?.Value;
            if (!Guid.TryParse(tenantIdClaim, out var tenantId))
            {
                return Results.Unauthorized();
            }

            if (!Guid.TryParse(workspaceId, out var workspaceGuid))
            {
                return Results.BadRequest("workspaceId must be a valid GUID.");
            }

            if (!await workspaceAccessService.WorkspaceBelongsToTenantAsync(workspaceGuid, tenantId, ct))
            {
                return Results.Forbid();
            }

            if (file == null || file.Length == 0)
            {
                return Results.BadRequest("File is required.");
            }

            await using var stream = file.OpenReadStream();

            var command = new UploadDocumentCommand(
                tenantId,
                workspaceGuid,
                file.FileName,
                stream,
                language);

            try
            {
                var document = await mediator.Send(command, ct);
                log.LogInformation(
                    "Document uploaded and enqueued: DocumentId={DocumentId}, WorkspaceId={WorkspaceId}, FileName={FileName}, TenantId={TenantId}",
                    document.Id, workspaceGuid, file.FileName, tenantId);
                return Results.Ok(new UploadDocumentResponse(document));
            }
            catch (Exception ex)
            {
                log.LogError(ex, "Document upload failed: FileName={FileName}, WorkspaceId={WorkspaceId}", file.FileName, workspaceGuid);
                throw;
            }
        })
        .DisableAntiforgery()
        .Accepts<IFormFile>("multipart/form-data");

        return routes;
    }
}

