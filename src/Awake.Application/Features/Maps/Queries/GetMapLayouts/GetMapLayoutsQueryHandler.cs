using System.Text.Json;
using Awake.Application.Common.Interfaces.Repositories;
using Awake.Application.Common.Models;
using MediatR;

namespace Awake.Application.Features.Maps.Queries.GetMapLayouts;

public class GetMapLayoutsQueryHandler(IMapLayoutRepository layouts)
    : IRequestHandler<GetMapLayoutsQuery, Result<IReadOnlyList<MapLayoutSummaryDto>>>
{
    public async Task<Result<IReadOnlyList<MapLayoutSummaryDto>>> Handle(
        GetMapLayoutsQuery request, CancellationToken cancellationToken)
    {
        var found = await layouts.GetByLocationAsync(request.Location, cancellationToken);

        var result = found
            .Select(layout => new MapLayoutSummaryDto(
                layout.Id,
                layout.Location,
                layout.Name,
                layout.AuthorId,
                layout.Author?.Username ?? "—",
                CountProps(layout.Props),
                layout.UpdatedAt))
            .ToList();

        return Result<IReadOnlyList<MapLayoutSummaryDto>>.Success(result);
    }

    /// <summary>
    /// Количество объектов для списка. Расстановка хранится документом, и это
    /// единственное, что о ней нужно знать до открытия — считаем на лету, не
    /// заводя денормализованное поле, которое пришлось бы держать в синхроне.
    /// </summary>
    private static int CountProps(string props)
    {
        try
        {
            using var document = JsonDocument.Parse(props);
            return document.RootElement.ValueKind == JsonValueKind.Array
                ? document.RootElement.GetArrayLength()
                : 0;
        }
        catch (JsonException)
        {
            return 0;
        }
    }
}
