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

public static class DocumentEndpoints
{
    public static IEndpointRouteBuilder MapDocuments(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/documents")
            .RequireAuthorization();

        group.MapGet("/workspaces/{workspaceId:guid}", async (Guid workspaceId, ClaimsPrincipal user, IMediator mediator, CancellationToken ct) =>
        {
            var tenantIdClaim = user.FindFirst("tenantId")?.Value;
            if (!Guid.TryParse(tenantIdClaim, out var tenantId))
            {
                return Results.Unauthorized();
            }

            var result = await mediator.Send(new GetDocumentsQuery(tenantId, workspaceId), ct);
            return Results.Ok(result);
        });

        group.MapPost(string.Empty, async (CreateDocumentRequest request, ClaimsPrincipal user, IMediator mediator, CancellationToken ct) =>
        {
            var tenantIdClaim = user.FindFirst("tenantId")?.Value;
            if (!Guid.TryParse(tenantIdClaim, out var tenantId))
            {
                return Results.Unauthorized();
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
        .RequireAuthorization(policy => policy.RequireRole("Owner", "Admin", "Member"));

        return routes;
    }
}

